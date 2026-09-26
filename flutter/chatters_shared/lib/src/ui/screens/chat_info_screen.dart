import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/endpoints.dart';
import '../../services/auth.dart';
import '../../services/notifications.dart';
import '../../services/stores.dart';
import '../navigation.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';
import 'chat_screen.dart';

const _timers = [0, 5, 30, 60, 3600, 86400, 604800];

class ChatInfoScreen extends StatefulWidget {
  const ChatInfoScreen({super.key, required this.host});
  final ChatScreenState host;

  @override
  State<ChatInfoScreen> createState() => _ChatInfoScreenState();
}

class _ChatInfoScreenState extends State<ChatInfoScreen> {
  List<String> _members = [];
  String? get _me => Auth.instance.user;
  ChatScreenState get host => widget.host;
  Map<String, dynamic> get chat => host.chatN.value!;
  String get _id => chat['id'] as String;

  @override
  void initState() {
    super.initState();
    _members = ((chat['members'] as List?) ?? []).cast<String>();
    if (chat['is_group'] == true) _loadMembers();
  }

  Future<void> _loadMembers() async {
    try {
      final d = await getChatMembers(_id);
      final list = (d is Map ? d['members'] as List? : d as List?) ?? [];
      if (mounted) setState(() => _members = list.map((e) => '$e').toList());
    } catch (_) {}
  }

  Future<void> _toggleMute() async {
    final next = chat['muted'] != true;
    host.patch({'muted': next});
    next ? Notifications.instance.mutedChats.add(_id) : Notifications.instance.mutedChats.remove(_id);
    try {
      await setChatMute(_id, next);
    } catch (e) {
      host.patch({'muted': !next});
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  Future<void> _chooseTimer() async {
    final p = context.p;
    final current = (chat['self_destruct_seconds'] as int?) ?? 0;
    final s = await showModalBottomSheet<int>(
      context: context,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              GradientIcon(Icons.local_fire_department_rounded,
                  size: 44, gradient: LinearGradient(colors: [p.warn, const Color(0xffef4444)])),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Self-destruct', style: TextStyle(color: p.text, fontSize: 20, fontWeight: FontWeight.w800)),
                  Text('New messages vanish this long after sending', style: TextStyle(color: p.subtext, fontSize: 13)),
                ]),
              ),
            ]),
            const SizedBox(height: 16),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final t in _timers)
                ChoiceChip(
                  label: Text(timerLabel(t)),
                  selected: t == current,
                  onSelected: (_) => Navigator.pop(c, t),
                ),
            ]),
          ]),
        ),
      ),
    );
    if (s == null || s == current) return;
    host.patch({'self_destruct_seconds': s});
    HapticFeedback.mediumImpact();
    try {
      await setSelfDestruct(_id, s);
    } catch (e) {
      host.patch({'self_destruct_seconds': current});
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  Future<void> _delete() async {
    final group = chat['is_group'] == true;
    final secret = chat['is_secret'] == true;
    final ok = await confirm(
      context,
      group ? 'Leave this group?' : 'Delete this chat?',
      secret
          ? 'The secret chat is deleted for both of you. This cannot be undone.'
          : group
              ? 'You will stop receiving its messages.'
              : 'It disappears from your list. The other person keeps their copy.',
      ok: group ? 'Leave group' : 'Delete chat',
      destructive: true,
    );
    if (!ok) return;
    try {
      await deleteChat(_id, scope: secret ? 'everyone' : 'me');
      ChatsStore.instance.remove(_id);
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  Future<void> _addMember() async {
    final name = await promptText(context, 'Add member', hint: 'Username', ok: 'Add', icon: Icons.person_add_alt_1_rounded);
    if (name == null || name.trim().isEmpty) return;
    try {
      await addMember(_id, name.trim());
      await _loadMembers();
      if (mounted) toast(context, '${name.trim()} added');
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return ValueListenableBuilder(
      valueListenable: host.chatN,
      builder: (context, _, __) {
        final title = chatTitle(chat, _me);
        final isGroup = chat['is_group'] == true;
        final isSecret = chat['is_secret'] == true;
        final pending = isSecret && chat['e2e_enabled'] != true;
        final muted = chat['muted'] == true;
        final timer = (chat['self_destruct_seconds'] as int?) ?? 0;
        final other = _members.where((m) => m != _me).firstOrNull;

        return Scaffold(
          extendBodyBehindAppBar: true,
          appBar: AppBar(),
          body: ListView(padding: EdgeInsets.zero, children: [
            SizedBox(
              height: 340,
              child: AuroraBackground(
                child: SafeArea(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Hero(
                      tag: 'avatar-$_id',
                      child: UserAvatar(userId: title, size: 116, group: isGroup, secret: isSecret, ring: true),
                    ),
                    const SizedBox(height: 16),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Text(title,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: p.text, fontSize: 26, fontWeight: FontWeight.w800)),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      isSecret
                          ? 'Secret chat · end-to-end encrypted'
                          : isGroup
                              ? '${_members.length} members'
                              : 'Direct message',
                      style: TextStyle(color: isSecret ? p.secure : p.subtext, fontWeight: FontWeight.w600),
                    ),
                  ]),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                _Quick(muted ? Icons.notifications_off_rounded : Icons.notifications_active_rounded,
                    muted ? 'Unmute' : 'Mute', LinearGradient(colors: [p.warn, const Color(0xfffbbf24)]), _toggleMute),
                if (isSecret && !pending)
                  _Quick(Icons.local_fire_department_rounded, timer > 0 ? timerLabel(timer) : 'Timer',
                      LinearGradient(colors: [const Color(0xfff97316), p.danger]), _chooseTimer),
                if (!isGroup && !isSecret && other != null)
                  _Quick(Icons.lock_rounded, 'Secret chat', p.secureGradient, () {
                    Navigator.of(context).popUntil((r) => r.isFirst);
                    openDirectChat(context, other, secret: true);
                  }),
                if (host.fingerprint.isNotEmpty)
                  _Quick(Icons.verified_user_rounded, 'Verify', p.secureGradient,
                      () => showSafetyNumber(context, host.fingerprint)),
                if (isGroup) _Quick(Icons.person_add_alt_1_rounded, 'Add', p.gradient, _addMember),
              ]),
            ),
            if (isGroup)
              SectionCard(title: 'Members', children: [
                for (final m in _members)
                  ListTile(
                    leading: UserAvatar(userId: m, size: 40),
                    title: Text(m == _me ? '$m (you)' : m, style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                    trailing: m == _me
                        ? null
                        : IconButton(
                            icon: Icon(Icons.chat_bubble_outline_rounded, color: p.primary),
                            onPressed: () {
                              Navigator.of(context).popUntil((r) => r.isFirst);
                              openDirectChat(context, m);
                            },
                          ),
                  ),
              ]),
            if (isSecret)
              SectionCard(title: 'Security', children: [
                const SettingsTile(
                  icon: Icons.enhanced_encryption_rounded,
                  title: 'End-to-end encrypted',
                  subtitle: 'Messages are encrypted on your device with P-256 + AES-256-GCM.',
                ),
                if (host.fingerprint.isNotEmpty)
                  SettingsTile(
                    icon: Icons.pin_rounded,
                    title: 'Safety number',
                    subtitle: host.fingerprint,
                    gradient: p.secureGradient,
                    onTap: () => showSafetyNumber(context, host.fingerprint),
                  ),
              ]),
            SectionCard(children: [
              SettingsTile(
                icon: isGroup ? Icons.logout_rounded : Icons.delete_rounded,
                title: isGroup ? 'Leave group' : (isSecret ? 'Delete secret chat' : 'Delete chat'),
                destructive: true,
                onTap: _delete,
              ),
            ]),
            const SizedBox(height: 40),
          ]),
        );
      },
    );
  }
}

class _Quick extends StatelessWidget {
  const _Quick(this.icon, this.label, this.gradient, this.onTap);
  final IconData icon;
  final String label;
  final Gradient gradient;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Pressable(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              color: p.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: p.border),
            ),
            child: Column(children: [
              GradientIcon(icon, size: 40, gradient: gradient),
              const SizedBox(height: 8),
              Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: p.text, fontSize: 12.5, fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      ),
    );
  }
}
