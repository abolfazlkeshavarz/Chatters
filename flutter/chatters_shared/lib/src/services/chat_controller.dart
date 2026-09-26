import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:pointycastle/export.dart' show ECPrivateKey;

import '../api/endpoints.dart';
import '../crypto/e2ee.dart';
import '../storage.dart';
import 'chat_socket.dart';
import '../ui/l10n.dart';

const _statusOrder = {'sent': 0, 'delivered': 1, 'seen': 2};

/// Delivery state only moves forwards.
String advanceStatus(String? current, String next) {
  final from = _statusOrder[current] ?? 0;
  final to = _statusOrder[next];
  if (to == null) return current ?? 'sent';
  return to > from ? next : (current ?? 'sent');
}

/// Messages are ordered by the server's sequence id, which every device agrees
/// on; the timestamp is only a fallback.
int compareMessages(Map a, Map b) {
  final ai = a['id'], bi = b['id'];
  if (ai is int && bi is int) return ai.compareTo(bi);
  final at = DateTime.tryParse('${a['created_at']}')?.millisecondsSinceEpoch ?? 0;
  final bt = DateTime.tryParse('${b['created_at']}')?.millisecondsSinceEpoch ?? 0;
  return at.compareTo(bt);
}

/// Drives one conversation: initial load, live updates, reconnect resync and
/// sending (plain or end-to-end encrypted).
class ChatController extends ChangeNotifier {
  ChatController(this.chatId) {
    _subs.add(ChatSocket.instance.messages.listen(_onSocket));
    _subs.add(ChatSocket.instance.reconnected.listen((_) {
      load();
      markSeen();
    }));
    _subs.add(ChatSocket.instance.statusStream.listen((s) {
      status = s;
      notifyListeners();
    }));
    load();
    markSeen();
  }

  final String chatId;
  final List<StreamSubscription> _subs = [];
  final Map<int, Map<String, dynamic>> _byId = {};

  List<Map<String, dynamic>> messages = [];
  SocketStatus status = ChatSocket.instance.status;
  bool loading = true;
  String error = '';
  bool disposed = false;

  bool encrypted = false;
  ECPrivateKey? privateKey;
  List<Recipient>? recipients;

  /// Called by the screen once the identity key is available.
  void setCrypto({required bool encrypted, ECPrivateKey? key, List<Recipient>? recipients}) {
    this.encrypted = encrypted;
    final hadKey = privateKey != null;
    privateKey = key;
    this.recipients = recipients;
    if (!hadKey && key != null) load();
  }

  Map<String, dynamic> _materialise(Map<String, dynamic> msg) {
    if (msg['is_encrypted'] != true) return msg;
    final key = privateKey;
    if (key == null) return {...msg, 'content': '', 'decryptError': 'locked'};
    try {
      return {...msg, 'content': decryptMessage(msg, key), 'decrypted': true};
    } catch (_) {
      return {...msg, 'content': '', 'decryptError': 'failed'};
    }
  }

  void _merge(Iterable<Map<String, dynamic>> incoming) {
    for (final m in incoming) {
      final id = m['id'];
      if (id is! int) continue;
      _byId[id] = {...?_byId[id], ...m};
    }
    _rebuild();
  }

  void _rebuild() {
    messages = _byId.values.toList()..sort(compareMessages);
    if (!disposed) notifyListeners();
  }

  Future<void> load() async {
    try {
      final data = await getMessages(chatId);
      _merge(data.map(_materialise));
      error = '';
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      if (!disposed) notifyListeners();
    }
  }

  void markSeen() => ChatSocket.instance.send({'type': 'seen', 'chat_id': chatId});

  void _onSocket(Map<String, dynamic> msg) {
    if (msg['chat_id'] != chatId) return;
    final type = msg['type'];
    if (type == 'status' || type == 'seen') {
      final next = type == 'seen' ? 'seen' : '${msg['status']}';
      final ids = ((msg['message_ids'] as List?) ?? []).toSet();
      var changed = false;
      for (final id in ids) {
        final m = _byId[id];
        if (m != null) {
          m['status'] = advanceStatus(m['status'] as String?, next);
          changed = true;
        }
      }
      if (changed) _rebuild();
      return;
    }
    if (type == 'deleted') {
      for (final id in (msg['ids'] as List? ?? [])) {
        _byId.remove(id);
      }
      _rebuild();
      return;
    }
    if (type == 'message' || type == 'media') {
      final rendered = _materialise(msg);
      if (msg['is_system'] == true) rendered['type'] = 'system';
      _merge([rendered]);
      if (msg['is_system'] != true && msg['from'] != Storage.username) markSeen();
    }
  }

  Future<bool> send(String text, int? replyTo) async {
    final body = text.trim();
    if (body.isEmpty) return false;
    if (!encrypted) {
      return ChatSocket.instance.send({'chat_id': chatId, 'content': body, 'reply_to': replyTo});
    }
    final people = recipients;
    if (people == null || people.isEmpty) {
      error = t('Cannot encrypt: no member keys are available.');
      notifyListeners();
      return false;
    }
    try {
      final enc = encryptMessage(body, people);
      return ChatSocket.instance.send({
        'chat_id': chatId,
        'content': enc['ciphertext'],
        'reply_to': replyTo,
        'is_encrypted': true,
        'cipher_iv': enc['iv'],
        'keys': enc['keys'],
      });
    } catch (e) {
      error = e.toString();
      notifyListeners();
      return false;
    }
  }

  void setError(String e) {
    error = e;
    notifyListeners();
  }

  @override
  void dispose() {
    disposed = true;
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }
}
