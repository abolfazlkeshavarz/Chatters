import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/endpoints.dart';
import 'chat_socket.dart';
import 'notifications.dart';

/// The chat list, shared by every screen and kept fresh from the socket.
class ChatsStore extends ChangeNotifier {
  ChatsStore._();
  static final ChatsStore instance = ChatsStore._();

  List<Map<String, dynamic>> chats = [];
  List<Map<String, dynamic>> announcements = [];
  bool loading = true;
  String error = '';
  final List<StreamSubscription> _subs = [];
  Timer? _debounce;

  static const _refreshTypes = {
    'message', 'media', 'deleted', 'chat_deleted', 'e2e_request', 'e2e_accepted', 'e2e_rejected', 'timer',
  };

  int get unreadTotal =>
      chats.where((c) => c['muted'] != true).fold(0, (a, c) => a + ((c['unread_count'] as int?) ?? 0));

  void start() {
    if (_subs.isNotEmpty) return;
    _subs.add(ChatSocket.instance.messages.listen((m) {
      if (_refreshTypes.contains(m['type'])) _scheduleLoad();
      if (m['type'] == 'announcement') loadAnnouncements();
    }));
    _subs.add(ChatSocket.instance.reconnected.listen((_) => load()));
    load();
    loadAnnouncements();
  }

  void stop() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs.clear();
    chats = [];
    announcements = [];
    loading = true;
  }

  void _scheduleLoad() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), load);
  }

  Future<List<Map<String, dynamic>>> load() async {
    try {
      chats = await getChats();
      error = '';
      Notifications.instance.mutedChats
        ..clear()
        ..addAll(chats.where((c) => c['muted'] == true).map((c) => c['id'] as String));
    } catch (e) {
      error = e.toString();
    }
    loading = false;
    notifyListeners();
    return chats;
  }

  Future<void> loadAnnouncements() async {
    try {
      announcements = await getAnnouncements();
      notifyListeners();
    } catch (_) {}
  }

  Future<void> dismissAnnouncement(int id) async {
    announcements = announcements.where((a) => a['id'] != id).toList();
    notifyListeners();
    try {
      await ackAnnouncement(id);
    } catch (_) {}
  }

  void patch(String id, Map<String, dynamic> values) {
    chats = [for (final c in chats) c['id'] == id ? {...c, ...values} : c];
    notifyListeners();
  }

  void remove(String id) {
    chats = chats.where((c) => c['id'] != id).toList();
    notifyListeners();
  }

  Map<String, dynamic>? byId(String id) => chats.where((c) => c['id'] == id).firstOrNull;
}

class ContactsStore extends ChangeNotifier {
  ContactsStore._();
  static final ContactsStore instance = ContactsStore._();

  List<Map<String, dynamic>> contacts = [];
  bool loading = true;

  List<String> get ids => contacts.map((c) => c['id'] as String).toList();

  Future<void> load() async {
    try {
      contacts = await getContacts();
    } catch (_) {}
    loading = false;
    notifyListeners();
  }

  Future<void> add(String name) async {
    await addContact(name);
    await load();
  }

  Future<void> remove(String id) async {
    contacts = contacts.where((c) => c['id'] != id).toList();
    notifyListeners();
    try {
      await removeContact(id);
    } finally {
      await load();
    }
  }
}
