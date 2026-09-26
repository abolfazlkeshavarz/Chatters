import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/endpoints.dart';
import '../../crypto/e2ee.dart';
import '../../crypto/keystore.dart';
import '../../services/auth.dart';
import '../../services/chat_controller.dart';
import '../../services/chat_socket.dart';
import '../../services/notifications.dart';
import '../../services/stores.dart';
import '../navigation.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/connection_banner.dart';
import '../widgets/design.dart';
import '../widgets/message_list.dart';
import '../widgets/wallpaper.dart';
import 'chat_info_screen.dart';
import '../l10n.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, this.chat, this.chatId});
  final Map<String, dynamic>? chat;
  final String? chatId;

  @override
  State<ChatScreen> createState() => ChatScreenState();
}

class ChatScreenState extends State<ChatScreen> {
  final chatN = ValueNotifier<Map<String, dynamic>?>(null);
  late final String _chatId;
  late final ChatController _ctl;
  StreamSubscription? _sub;

  Identity? _identity;
  String _setupError = '';
  String fingerprint = '';
  List<String> _missingKeys = [];
  bool _cryptoReady = true;
  bool _cryptoStarted = false;
  bool _busy = false;
  bool _uploading = false;
  Map<String, dynamic>? _replyTo;
  final _text = TextEditingController();
  final _focus = FocusNode();

  String? get _me => Auth.instance.user;
  Map<String, dynamic>? get _chat => chatN.value;

  @override
  void initState() {
    super.initState();
    chatN.value = widget.chat;
    _chatId = (widget.chat?['id'] as String?) ?? widget.chatId!;
    Notifications.instance.activeChatId = _chatId;
    _ctl = ChatController(_chatId)..addListener(_onCtl);
    _text.addListener(() => setState(() {}));

    if (_chat == null) {
      _refreshChat();
    } else {
      _maybeSetupCrypto();
    }

    _sub = ChatSocket.instance.messages.listen((msg) {
      if (msg['chat_id'] != _chatId) return;
      switch (msg['type']) {
        case 'timer':
          patch({'self_destruct_seconds': (msg['seconds'] as int?) ?? 0});
        case 'chat_deleted':
        case 'e2e_rejected':
          if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
        case 'e2e_accepted':
          patch({'e2e_status': 'accepted', 'e2e_enabled': true});
          _maybeSetupCrypto();
      }
    });
  }

  void _onCtl() {
    if (mounted) setState(() {});
  }

  Future<void> _refreshChat() async {
    final list = await ChatsStore.instance.load();
    final found = list.where((c) => c['id'] == _chatId).firstOrNull;
    if (found != null && mounted) {
      setState(() => chatN.value = found);
      _maybeSetupCrypto();
    }
  }

  void patch(Map<String, dynamic> values) {
    if (_chat == null || !mounted) return;
    setState(() => chatN.value = {..._chat!, ...values});
    ChatsStore.instance.patch(_chatId, values);
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
        _setupError = t('Your encryption key is not on this device. Sign out and back in to unlock this chat.');
        return;
      }
      final data = await getChatKeys(_chatId);
      final members = ((data['members'] as List?) ?? []).cast<Map<String, dynamic>>();
      final recipients = members.map((m) => Recipient(m['user_id'] as String, m['public_key'] as String)).toList();
      _identity = stored;
      _missingKeys = ((data['without_keys'] as List?) ?? []).cast<String>();
      final others = recipients.where((r) => r.userId != _me).toList();
      if (others.length == 1) fingerprint = safetyNumber(stored.publicKeyB64, others.first.publicKey);
      _ctl.setCrypto(encrypted: true, key: stored.privateKey, recipients: recipients);
    } catch (e) {
      _setupError = errText(e);
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
    _focus.dispose();
    super.dispose();
  }

  /* ----------------------------------------------------------- actions */

  Future<void> _send() async {
    final text = _text.text;
    if (text.trim().isEmpty) return;
    HapticFeedback.lightImpact();
    final ok = await _ctl.send(text, _replyTo?['id'] as int?);
    if (ok) {
      _text.clear();
      setState(() => _replyTo = null);
    } else if (mounted) {
      toast(context, _ctl.error.isNotEmpty ? errText(_ctl.error) : t('Not connected — message not sent'), error: true);
    }
  }

  Future<void> _attach([String? preset]) async {
    final p = context.p;
    final choice = preset ??
        await showModalBottomSheet<String>(
          context: context,
          builder: (c) => SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Row(children: [
                for (final (key, icon, label, g) in [
                  ('photo', Icons.photo_library_rounded, t('Gallery'), p.gradient),
                  ('camera', Icons.photo_camera_rounded, t('Camera'),
                      const LinearGradient(colors: [Color(0xff2563eb), Color(0xff06b6d4)])),
                  ('file', Icons.insert_drive_file_rounded, t('File'),
                      const LinearGradient(colors: [Color(0xfff97316), Color(0xffe11d48)])),
                ])
                  Expanded(
                    child: Pressable(
                      onTap: () => Navigator.pop(c, key),
                      child: Column(children: [
                        GradientIcon(icon, size: 64, gradient: g, radius: 22),
                        const SizedBox(height: 8),
                        Text(label, style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                      ]),
                    ),
                  ),
              ]),
            ),
          ),
        );
    if (choice == null) return;
    try {
      String? path;
      String? name;
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
      setState(() => _uploading = true);
      await uploadMedia(_chatId, path, filename: name);
      HapticFeedback.lightImpact();
    } catch (e) {
      if (mounted) toast(context, t('Upload failed: {error}', {'error': errText(e)}), error: true);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _deleteMessage(Map<String, dynamic> m, String scope) async {
    try {
      await deleteMessage(m['id'] as int, scope: scope);
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  String? _peerId(Map<String, dynamic> chat) =>
      ((chat['members'] as List?) ?? []).cast<String>().where((m) => m != _me).firstOrNull;

  void _openInfo() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ChatInfoScreen(host: this)),
    );
  }

  /* ------------------------------------------------------------- build */

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final chat = _chat;
    if (chat == null) {
      return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    }
    final title = chatTitle(chat, _me);
    final isGroup = chat['is_group'] == true;
    final timer = (chat['self_destruct_seconds'] as int?) ?? 0;
    final members = ((chat['members'] as List?) ?? []).length;

    final subtitle = _pending
        ? t('Waiting to be accepted')
        : _isSecret || _secure
            ? '${t('End-to-end encrypted')}${timer > 0 ? ' · ${timerLabel(timer)}' : ''}'
            : isGroup
                ? t('{n} members', {'n': members})
                : t('Tap for info');

    return Scaffold(
      extendBodyBehindAppBar: true,
      resizeToAvoidBottomInset: true,
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(kToolbarHeight + 4),
        child: Glass(
          radius: 0,
          opacity: p.dark ? 0.6 : 0.75,
          child: SafeArea(
            bottom: false,
            child: SizedBox(
              height: kToolbarHeight + 4,
              child: Row(children: [
                const BackButton(),
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: _openInfo,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Hero(
                          tag: 'avatar-$_chatId',
                          child: UserAvatar(userId: title, size: 42, group: isGroup, secret: _isSecret),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                            Text(title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: p.text, fontSize: 17, fontWeight: FontWeight.w700)),
                            Row(children: [
                              if (_isSecret || _secure) ...[
                                Icon(Icons.lock_rounded, size: 12, color: p.secure),
                                const SizedBox(width: 3),
                              ],
                              Flexible(
                                child: Text(subtitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                        fontSize: 12.5,
                                        color: _isSecret || _secure ? p.secure : p.subtext,
                                        fontWeight: FontWeight.w500)),
                              ),
                            ]),
                          ]),
                        ),
                      ]),
                    ),
                  ),
                ),
                if (!isGroup && !_pending && _peerId(chat) != null)
                  IconButton(
                    tooltip: t('Voice call'),
                    icon: Icon(Icons.call_rounded, color: p.primary),
                    onPressed: () => startCall(context, _chatId, _peerId(chat)!),
                  ),
                if (timer > 0)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: 4),
                    child: Icon(Icons.local_fire_department_rounded, color: p.warn),
                  ),
                IconButton(icon: const Icon(Icons.more_vert_rounded), onPressed: _openInfo),
              ]),
            ),
          ),
        ),
      ),
      body: Stack(children: [
        Positioned.fill(
          child: ListenableBuilder(
            listenable: AppSettings.instance,
            builder: (_, __) =>
                AppSettings.instance.wallpaper ? ChatWallpaper(secure: _isSecret) : ColoredBox(color: p.bg),
          ),
        ),
        SafeArea(
          child: Column(children: [
            const SizedBox(height: kToolbarHeight + 4),
            ConnectionBanner(status: _ctl.status),
            Expanded(child: _pending ? _pendingView(chat, title) : _activeView(isGroup)),
          ]),
        ),
      ]),
    );
  }

  Widget _pendingView(Map<String, dynamic> chat, String title) {
    final p = context.p;
    final requestedByMe = chat['e2e_requested_by'] == _me;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: FadeSlideIn(
          child: Glass(
            radius: 30,
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              GradientIcon(requestedByMe ? Icons.hourglass_top_rounded : Icons.lock_person_rounded,
                  size: 84, radius: 30, gradient: p.secureGradient),
              const SizedBox(height: 20),
              Text(requestedByMe ? t('Invitation sent') : t('Secret chat invitation'),
                  style: TextStyle(color: p.text, fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(
                requestedByMe
                    ? t('You can message {name} as soon as they accept. Everything here will be end-to-end encrypted.', {'name': title})
                    : t('{name} wants to start an end-to-end encrypted chat. Only the two of you will be able to read it.', {'name': chat['e2e_requested_by']}),
                textAlign: TextAlign.center,
                style: TextStyle(color: p.subtext, height: 1.5),
              ),
              const SizedBox(height: 20),
              for (final (icon, text) in [
                (Icons.enhanced_encryption_rounded, t('Encrypted on your device')),
                (Icons.local_fire_department_rounded, t('Optional self-destruct timer')),
                (Icons.verified_user_rounded, t('Verify with a safety number')),
              ])
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    Icon(icon, size: 18, color: p.secure),
                    const SizedBox(width: 10),
                    Text(text, style: TextStyle(color: p.text)),
                  ]),
                ),
              if (!requestedByMe) ...[
                const SizedBox(height: 24),
                GradientButton(
                  label: t('Accept'),
                  icon: Icons.check_rounded,
                  gradient: p.secureGradient,
                  busy: _busy,
                  onPressed: () async {
                    setState(() => _busy = true);
                    try {
                      await acceptE2E(_chatId);
                      HapticFeedback.mediumImpact();
                      patch({'e2e_status': 'accepted', 'e2e_enabled': true});
                      _maybeSetupCrypto();
                    } catch (e) {
                      if (mounted) toast(context, errText(e), error: true);
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () async {
                          setState(() => _busy = true);
                          try {
                            await rejectE2E(_chatId);
                            if (mounted) Navigator.pop(context);
                          } catch (e) {
                            if (mounted) {
                              toast(context, errText(e), error: true);
                              setState(() => _busy = false);
                            }
                          }
                        },
                  child: Text(t('Decline'), style: TextStyle(color: p.danger, fontWeight: FontWeight.w600)),
                ),
              ],
            ]),
          ),
        ),
      ),
    );
  }

  Widget _activeView(bool isGroup) {
    final p = context.p;
    final blocked = _secure && (_setupError.isNotEmpty || _identity == null);
    return Column(children: [
      if (_setupError.isNotEmpty) _banner(Icons.lock_outline_rounded, _setupError, p.warn),
      if (_secure && _missingKeys.isNotEmpty)
        _banner(Icons.key_off_rounded,
            t('{names}: no encryption key yet', {'names': _missingKeys.join(', ')}), p.warn),
      Expanded(
        child: _ctl.loading || !_cryptoReady
            ? const Center(child: CircularProgressIndicator())
            : MessageList(
                messages: _ctl.messages,
                me: _me,
                secure: _secure,
                group: isGroup,
                header: _secure ? _secureHeader() : null,
                onReply: (m) {
                  HapticFeedback.selectionClick();
                  setState(() => _replyTo = m);
                  _focus.requestFocus();
                },
                onDelete: _deleteMessage,
              ),
      ),
      _composer(blocked),
    ]);
  }

  Widget _secureHeader() {
    final p = context.p;
    return Center(
      child: GestureDetector(
        onTap: fingerprint.isNotEmpty ? () => showSafetyNumber(context, fingerprint) : null,
        child: Container(
          margin: const EdgeInsets.fromLTRB(32, 12, 32, 12),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: p.secure.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: p.secure.withValues(alpha: 0.3)),
          ),
          child: Column(children: [
            Icon(Icons.lock_rounded, color: p.secure),
            const SizedBox(height: 6),
            Text(t('Messages in this chat are end-to-end encrypted. Nobody else — not even the server — can read them.'),
                textAlign: TextAlign.center, style: TextStyle(color: p.secure, fontSize: 12.5, height: 1.4)),
            if (fingerprint.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(t('Tap to verify safety number'),
                    style: TextStyle(color: p.secure, fontSize: 12.5, fontWeight: FontWeight.w700)),
              ),
          ]),
        ),
      ),
    );
  }

  Widget _banner(IconData icon, String text, Color color) => Container(
        margin: const EdgeInsets.fromLTRB(12, 6, 12, 0),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(16)),
        child: Row(children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w500))),
        ]),
      );

  Widget _composer(bool blocked) {
    final p = context.p;
    final hasText = _text.text.trim().isNotEmpty;
    final g = _secure ? p.secureGradient : p.gradient;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
      child: Glass(
        radius: 28,
        padding: const EdgeInsets.all(6),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          AnimatedSize(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            child: _replyTo == null
                ? const SizedBox(width: double.infinity)
                : Container(
                    margin: const EdgeInsets.fromLTRB(4, 2, 4, 6),
                    padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                    decoration: BoxDecoration(
                      color: p.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Row(children: [
                      Icon(Icons.reply_rounded, color: p.primary, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(t('Reply to {name}', {'name': _replyTo!['from']}),
                              style: TextStyle(color: p.primary, fontSize: 12.5, fontWeight: FontWeight.w700)),
                          Text(messagePreview(_replyTo!),
                              maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.subtext, fontSize: 13)),
                        ]),
                      ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.close_rounded, size: 18),
                        onPressed: () => setState(() => _replyTo = null),
                      ),
                    ]),
                  ),
          ),
          if (_uploading)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 2, 8, 6),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(minHeight: 4, color: p.primary, backgroundColor: p.surfaceHigh),
              ),
            ),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (!_secure)
              IconButton(
                icon: Icon(Icons.add_circle_outline_rounded, color: p.subtext, size: 26),
                onPressed: blocked || _uploading ? null : _attach,
              )
            else
              const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _text,
                focusNode: _focus,
                enabled: !blocked,
                minLines: 1,
                maxLines: 6,
                textCapitalization: TextCapitalization.sentences,
                style: TextStyle(color: p.text, fontSize: 15.5),
                decoration: InputDecoration(
                  hintText: blocked ? t('Chat is locked') : (_secure ? t('Encrypted message') : t('Message')),
                  filled: false,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 12),
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  disabledBorder: InputBorder.none,
                ),
              ),
            ),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 220),
              transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
              child: hasText
                  ? Pressable(
                      key: const ValueKey('send'),
                      onTap: blocked ? null : _send,
                      child: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          gradient: g,
                          shape: BoxShape.circle,
                          boxShadow: [BoxShadow(color: p.primary.withValues(alpha: 0.4), blurRadius: 12, offset: const Offset(0, 4))],
                        ),
                        child: const Icon(Icons.arrow_upward_rounded, color: Colors.white),
                      ),
                    )
                  : _secure
                      ? const SizedBox(key: ValueKey('none'), width: 44, height: 44)
                      : IconButton(
                          key: const ValueKey('camera'),
                          icon: Icon(Icons.photo_camera_rounded, color: p.subtext),
                          onPressed: blocked || _uploading ? null : () => _attach('camera'),
                        ),
            ),
          ]),
        ]),
      ),
    );
  }
}

String timerLabel(int s) => switch (s) {
      0 => t('Off'),
      5 => t('5 seconds'),
      30 => t('30 seconds'),
      60 => t('1 minute'),
      3600 => t('1 hour'),
      86400 => t('1 day'),
      604800 => t('1 week'),
      _ => '${s}s',
    };

void showSafetyNumber(BuildContext context, String fingerprint) {
  final p = context.p;
  final groups = fingerprint.split(' ');
  showModalBottomSheet(
    context: context,
    builder: (c) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          GradientIcon(Icons.verified_user_rounded, size: 64, gradient: p.secureGradient),
          const SizedBox(height: 16),
          Text(t('Safety number'), style: TextStyle(color: p.text, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(t('Compare these numbers with the other person in person or on a call. If they match, your chat is private.'),
              textAlign: TextAlign.center, style: TextStyle(color: p.subtext, height: 1.5)),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: p.secure.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Wrap(
              alignment: WrapAlignment.center,
              spacing: 18,
              runSpacing: 10,
              children: [
                for (final g in groups)
                  Text(g,
                      style: TextStyle(
                          color: p.text,
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 2,
                          fontFeatures: const [FontFeature.tabularFigures()])),
              ],
            ),
          ),
          const SizedBox(height: 16),
          TextButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: fingerprint));
              Navigator.pop(c);
              toast(context, t('Safety number copied'));
            },
            icon: const Icon(Icons.copy_rounded),
            label: Text(t('Copy')),
          ),
        ]),
      ),
    ),
  );
}
