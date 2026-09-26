import 'dart:async';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/endpoints.dart';
import '../../crypto/e2ee.dart';
import '../../crypto/keystore.dart';
import '../../services/auth.dart';
import '../../services/chat_controller.dart';
import '../../services/chat_socket.dart';
import '../../services/notifications.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/connection_banner.dart';
import '../widgets/message_list.dart';
import 'chat_list_screen.dart' show chatTitle;

const _timerOptions = [
  ('Off', 0),
  ('5 seconds', 5),
  ('30 seconds', 30),
  ('1 minute', 60),
  ('1 hour', 3600),
  ('1 day', 86400),
  ('1 week', 604800),
];

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, this.chat, this.chatId});
  final Map<String, dynamic>? chat;
  final String? chatId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  Map<String, dynamic>? _chat;
  late final String _chatId;
  late final ChatController _ctl;
  StreamSubscription? _sub;

  Identity? _identity;
  String _setupError = '';
  String _fingerprint = '';
  List<String> _missingKeys = [];
  bool _cryptoReady = true;
  bool _cryptoStarted = false;
  bool _busy = false;
  Map<String, dynamic>? _replyTo;
  final _text = TextEditingController();

  String? get _me => Auth.instance.user;

  @override
  void initState() {
    super.initState();
    _chat = widget.chat;
    _chatId = (widget.chat?['id'] as String?) ?? widget.chatId!;
    Notifications.instance.activeChatId = _chatId;
    _ctl = ChatController(_chatId);
    _ctl.addListener(_onCtl);

    if (_chat == null) {
      _refreshChat();
    } else {
      _maybeSetupCrypto();
    }

    _sub = ChatSocket.instance.messages.listen((msg) {
      if (msg['chat_id'] != _chatId) return;
      switch (msg['type']) {
        case 'timer':
          _patch({'self_destruct_seconds': (msg['seconds'] as int?) ?? 0});
        case 'chat_deleted':
        case 'e2e_rejected':
          if (mounted) Navigator.of(context).maybePop();
        case 'e2e_accepted':
          _patch({'e2e_status': 'accepted', 'e2e_enabled': true});
          _maybeSetupCrypto();
      }
    });
  }

  void _onCtl() {
    if (mounted) setState(() {});
  }

  Future<void> _refreshChat() async {
    try {
      final list = await getChats();
      final found = list.where((c) => c['id'] == _chatId).firstOrNull;
      if (found != null && mounted) {
        setState(() => _chat = found);
        _maybeSetupCrypto();
      }
    } catch (_) {}
  }

  void _patch(Map<String, dynamic> patch) {
    if (_chat == null || !mounted) return;
    setState(() => _chat = {..._chat!, ...patch});
  }

  bool get _secure => _chat?['e2e_enabled'] == true;
  bool get _isSecret => _chat?['is_secret'] == true;
  bool get _pending => _isSecret && !_secure && _chat?['e2e_status'] == 'pending';

  Future<void> _maybeSetupCrypto() async {
    if (!_secure || _cryptoStarted) return;
    _cryptoStarted = true;
    setState(() {
      _cryptoReady = false;
      _setupError = '';
    });
    try {
      final stored = await Keystore.load(_me);
      if (stored == null) {
        _setupError = 'Your encryption key is not on this device. Sign out and back in to unlock secure chat.';
        return;
      }
      final data = await getChatKeys(_chatId);
      final members = ((data['members'] as List?) ?? []).cast<Map<String, dynamic>>();
      final recipients = members.map((m) => Recipient(m['user_id'] as String, m['public_key'] as String)).toList();
      _identity = stored;
      _missingKeys = ((data['without_keys'] as List?) ?? []).cast<String>();
      final others = recipients.where((r) => r.userId != _me).toList();
      if (others.length == 1) _fingerprint = safetyNumber(stored.publicKeyB64, others.first.publicKey);
      _ctl.setCrypto(encrypted: true, key: stored.privateKey, recipients: recipients);
    } catch (e) {
      _setupError = e.toString();
    } finally {
      if (mounted) setState(() => _cryptoReady = true);
    }
  }

  @override
  void dispose() {
    if (Notifications.instance.activeChatId == _chatId) Notifications.instance.activeChatId = null;
    _sub?.cancel();
    _ctl.removeListener(_onCtl);
    _ctl.dispose();
    _text.dispose();
    super.dispose();
  }

  /* ----------------------------------------------------------- actions */

  Future<void> _send() async {
    final text = _text.text;
    if (text.trim().isEmpty) return;
    final ok = await _ctl.send(text, _replyTo?['id'] as int?);
    if (ok) {
      _text.clear();
      setState(() => _replyTo = null);
    } else if (_ctl.error.isEmpty) {
      _ctl.setError('Not connected — message not sent.');
    }
  }

  Future<void> _attach() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo), title: const Text('Photo'), onTap: () => Navigator.pop(c, 'photo')),
          ListTile(leading: const Icon(Icons.photo_camera), title: const Text('Camera'), onTap: () => Navigator.pop(c, 'camera')),
          ListTile(leading: const Icon(Icons.attach_file), title: const Text('File'), onTap: () => Navigator.pop(c, 'file')),
        ]),
      ),
    );
    if (choice == null) return;
    String? path;
    String? name;
    try {
      if (choice == 'file') {
        final r = await FilePicker.platform.pickFiles();
        path = r?.files.single.path;
        name = r?.files.single.name;
      } else {
        final x = await ImagePicker().pickImage(
            source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery, imageQuality: 85);
        path = x?.path;
        name = x?.name;
      }
      if (path == null) return;
      setState(() => _busy = true);
      await uploadMedia(_chatId, path, filename: name);
    } catch (e) {
      _ctl.setError('Upload failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteMessage(Map<String, dynamic> m, String scope) async {
    try {
      await deleteMessage(m['id'] as int, scope: scope);
    } catch (e) {
      _ctl.setError(e.toString());
    }
  }

  Future<void> _chooseTimer() async {
    final current = (_chat?['self_destruct_seconds'] as int?) ?? 0;
    final seconds = await showDialog<int>(
      context: context,
      builder: (c) => SimpleDialog(
        title: const Text('Self-destruct timer'),
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 24, vertical: 4),
            child: Text('New messages are deleted this long after they are sent, on every device.'),
          ),
          for (final (label, s) in _timerOptions)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(c, s),
              child: Text('${s == current ? '✓ ' : ''}$label'),
            ),
        ],
      ),
    );
    if (seconds == null || seconds == current) return;
    _patch({'self_destruct_seconds': seconds});
    try {
      await setSelfDestruct(_chatId, seconds);
    } catch (e) {
      _patch({'self_destruct_seconds': current});
      _ctl.setError(e.toString());
    }
  }

  Future<void> _toggleMute() async {
    final next = _chat?['muted'] != true;
    _patch({'muted': next});
    next ? Notifications.instance.mutedChats.add(_chatId) : Notifications.instance.mutedChats.remove(_chatId);
    try {
      await setChatMute(_chatId, next);
    } catch (_) {
      _patch({'muted': !next});
    }
  }

  Future<void> _startSecret() async {
    final other = ((_chat?['members'] as List?) ?? []).cast<String>().where((m) => m != _me).firstOrNull;
    if (other == null) return;
    final ok = await confirm(context, 'Start a secret chat?',
        'It opens as a separate, end-to-end encrypted conversation once they accept. This chat is unchanged.',
        ok: 'Start');
    if (!ok) return;
    try {
      final res = await createSecretChat(other);
      if (!mounted) return;
      Navigator.pushReplacement(
          context, MaterialPageRoute(builder: (_) => ChatScreen(chatId: res['chat_id'] as String)));
    } catch (e) {
      _ctl.setError(e.toString());
    }
  }

  Future<void> _deleteChat() async {
    final group = _chat?['is_group'] == true;
    final ok = await confirm(
      context,
      group ? 'Leave group?' : 'Delete chat?',
      _isSecret
          ? 'This deletes the secret chat for both of you. Cannot be undone.'
          : group
              ? 'You will stop receiving its messages.'
              : 'Removes it from your list. The other person keeps their copy.',
      ok: group ? 'Leave' : 'Delete',
      destructive: true,
    );
    if (!ok) return;
    try {
      await deleteChat(_chatId, scope: _isSecret ? 'everyone' : 'me');
      if (mounted) Navigator.pop(context);
    } catch (e) {
      _ctl.setError(e.toString());
    }
  }

  void _showVerify() {
    showDialog(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Verify safety number'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Compare this number with the other person, in person or over a trusted channel. '
              'If it matches, nobody is intercepting your messages.'),
          const SizedBox(height: 16),
          SelectableText(_fingerprint,
              textAlign: TextAlign.center,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 18, letterSpacing: 1.5)),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('Close'))],
      ),
    );
  }

  Future<void> _showMembers() async {
    try {
      final data = await getChatMembers(_chatId);
      final list = data is Map ? (data['members'] as List? ?? []) : (data as List? ?? []);
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Members'),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView(
              shrinkWrap: true,
              children: list.map((m) {
                final id = m is Map ? '${m['id'] ?? m['user_id'] ?? m['username']}' : '$m';
                return ListTile(leading: UserAvatar(userId: id, size: 32), title: Text(id));
              }).toList(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () async {
                final name = await promptText(c, 'Add member', hint: 'Username');
                if (name == null || name.trim().isEmpty) return;
                try {
                  await addMember(_chatId, name.trim());
                  if (c.mounted) Navigator.pop(c);
                  _refreshChat();
                } catch (e) {
                  if (c.mounted) toast(c, e.toString());
                }
              },
              child: const Text('Add member'),
            ),
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('Close')),
          ],
        ),
      );
    } catch (e) {
      _ctl.setError(e.toString());
    }
  }

  /* ------------------------------------------------------------- build */

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final chat = _chat;
    if (chat == null) {
      return Scaffold(appBar: AppBar(), body: Center(child: Text('Loading conversation…', style: TextStyle(color: p.subtext))));
    }
    final title = chatTitle(chat, _me);
    final isGroup = chat['is_group'] == true;
    final timer = (chat['self_destruct_seconds'] as int?) ?? 0;
    final timerLabel = _timerOptions.where((o) => o.$2 == timer).map((o) => o.$1).firstOrNull ?? '${timer}s';

    final subtitle = _pending
        ? 'Secret chat · pending'
        : _isSecret
            ? 'Secret chat${timer > 0 ? ' · 🔥 $timerLabel' : ''}'
            : _secure
                ? 'End-to-end encrypted'
                : isGroup
                    ? '${((chat['members'] as List?) ?? []).length} members'
                    : '';

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        shape: _secure || _isSecret ? Border(bottom: BorderSide(color: p.secure, width: 1.5)) : null,
        title: Row(children: [
          if (!isGroup) ...[UserAvatar(userId: title, size: 34), const SizedBox(width: 10)],
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${_secure || _isSecret ? '🔒 ' : ''}$title', maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              if (subtitle.isNotEmpty)
                Text(subtitle, style: TextStyle(fontSize: 12, color: _isSecret || _secure ? p.secure : p.subtext)),
            ]),
          ),
        ]),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) {
              switch (v) {
                case 'mute': _toggleMute();
                case 'timer': _chooseTimer();
                case 'secret': _startSecret();
                case 'verify': _showVerify();
                case 'members': _showMembers();
                case 'delete': _deleteChat();
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(value: 'mute', child: Text(chat['muted'] == true ? '🔔  Unmute' : '🔕  Mute')),
              if (_isSecret && !_pending) const PopupMenuItem(value: 'timer', child: Text('🔥  Self-destruct timer')),
              if (!isGroup && !_isSecret) const PopupMenuItem(value: 'secret', child: Text('🔒  Start secret chat')),
              if (_fingerprint.isNotEmpty) const PopupMenuItem(value: 'verify', child: Text('🛡️  Verify safety number')),
              if (isGroup) const PopupMenuItem(value: 'members', child: Text('👥  Members')),
              PopupMenuItem(
                value: 'delete',
                child: Text(isGroup ? '🚪  Leave group' : '🗑️  Delete chat', style: TextStyle(color: p.danger)),
              ),
            ],
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Column(children: [
          ConnectionBanner(status: _ctl.status),
          Expanded(child: _pending ? _pendingView(chat, title) : _activeView()),
        ]),
      ),
    );
  }

  Widget _pendingView(Map<String, dynamic> chat, String title) {
    final p = context.p;
    final requestedByMe = chat['e2e_requested_by'] == _me;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: requestedByMe
            ? Text('Waiting for $title to accept this secret chat. You can send messages once they do.',
                textAlign: TextAlign.center, style: TextStyle(color: p.subtext))
            : Column(mainAxisSize: MainAxisSize.min, children: [
                Text('${chat['e2e_requested_by']} wants to start an end-to-end encrypted secret chat with you.',
                    textAlign: TextAlign.center, style: TextStyle(color: p.text)),
                if (_ctl.error.isNotEmpty)
                  Padding(padding: const EdgeInsets.only(top: 8), child: Text(_ctl.error, style: TextStyle(color: p.danger))),
                const SizedBox(height: 16),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: p.secure),
                    onPressed: _busy
                        ? null
                        : () async {
                            setState(() => _busy = true);
                            try {
                              await acceptE2E(_chatId);
                              _patch({'e2e_status': 'accepted', 'e2e_enabled': true});
                              _maybeSetupCrypto();
                            } catch (e) {
                              _ctl.setError(e.toString());
                            } finally {
                              if (mounted) setState(() => _busy = false);
                            }
                          },
                    child: const Text('Accept'),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () async {
                            setState(() => _busy = true);
                            try {
                              await rejectE2E(_chatId);
                              if (mounted) Navigator.pop(context);
                            } catch (e) {
                              _ctl.setError(e.toString());
                              if (mounted) setState(() => _busy = false);
                            }
                          },
                    child: const Text('Reject'),
                  ),
                ]),
              ]),
      ),
    );
  }

  Widget _activeView() {
    final p = context.p;
    final blocked = _secure && (_setupError.isNotEmpty || _identity == null);
    return Column(children: [
      if (_secure && _missingKeys.isNotEmpty)
        _note('⚠️ ${_missingKeys.join(', ')} ${_missingKeys.length == 1 ? 'has' : 'have'} no encryption key yet and cannot read messages.',
            p.warnBg, p.warnText),
      if (_setupError.isNotEmpty) _note(_setupError, p.warnBg, p.warnText),
      if (_ctl.error.isNotEmpty)
        GestureDetector(
          onTap: () => _ctl.setError(''),
          child: _note('${_ctl.error}  ✕', p.danger.withValues(alpha: 0.12), p.danger),
        ),
      Expanded(
        child: _ctl.loading || !_cryptoReady
            ? const Center(child: CircularProgressIndicator())
            : MessageList(
                messages: _ctl.messages,
                me: _me,
                secure: _secure,
                onReply: (m) => setState(() => _replyTo = m),
                onDelete: _deleteMessage,
              ),
      ),
      if (_replyTo != null)
        Container(
          color: p.card,
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 0),
          child: Row(children: [
            Container(width: 3, height: 32, color: p.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Replying to ${_replyTo!['from']}', style: TextStyle(color: p.primary, fontSize: 12)),
                Text(messagePreview(_replyTo!), maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: p.subtext, fontSize: 13)),
              ]),
            ),
            IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _replyTo = null)),
          ]),
        ),
      Container(
        color: p.card,
        padding: const EdgeInsets.fromLTRB(4, 6, 4, 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          if (!_secure)
            IconButton(
              icon: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.attach_file),
              onPressed: _busy || blocked ? null : _attach,
            ),
          Expanded(
            child: TextField(
              controller: _text,
              enabled: !blocked,
              minLines: 1,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                hintText: blocked ? 'Secure chat is locked' : (_secure ? '🔒 Encrypted message' : 'Message'),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide(color: p.border)),
                fillColor: p.bg,
                isDense: true,
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.send, color: _secure ? p.secure : p.primary),
            onPressed: blocked ? null : _send,
          ),
        ]),
      ),
    ]);
  }

  Widget _note(String text, Color bg, Color fg) => Container(
        width: double.infinity,
        color: bg,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Text(text, style: TextStyle(color: fg, fontSize: 13)),
      );
}
