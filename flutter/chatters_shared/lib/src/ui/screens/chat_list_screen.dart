import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../api/endpoints.dart';
import '../../services/auth.dart';
import '../../services/chat_socket.dart';
import '../../services/stores.dart';
import '../navigation.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/connection_banner.dart';
import '../widgets/design.dart';
import 'new_chat_sheet.dart';

String relativeTime(String? ts) {
  final d = ts == null ? null : DateTime.tryParse(ts)?.toLocal();
  if (d == null) return '';
  final now = DateTime.now();
  final diff = now.difference(d);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final days = today.difference(day).inDays;
  if (days == 0) return DateFormat.Hm().format(d);
  if (days == 1) return 'Yesterday';
  if (days < 7) return DateFormat.E().format(d);
  return DateFormat.MMMd().format(d);
}

enum _Filter { all, unread, groups, secret }

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});
  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  final _store = ChatsStore.instance;
  final _search = TextEditingController();
  String _query = '';
  _Filter _filter = _Filter.all;
  SocketStatus _status = ChatSocket.instance.status;

  @override
  void initState() {
    super.initState();
    ChatSocket.instance.statusStream.listen((s) {
      if (mounted) setState(() => _status = s);
    });
  }

  List<Map<String, dynamic>> _visible(String? me) {
    return _store.chats.where((c) {
      final unread = ((c['unread_count'] as int?) ?? 0) > 0;
      final ok = switch (_filter) {
        _Filter.all => true,
        _Filter.unread => unread,
        _Filter.groups => c['is_group'] == true,
        _Filter.secret => c['is_secret'] == true,
      };
      if (!ok) return false;
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      return chatTitle(c, me).toLowerCase().contains(q) ||
          ((c['members'] as List?) ?? []).any((m) => '$m'.toLowerCase().contains(q));
    }).toList();
  }

  Future<void> _delete(Map<String, dynamic> chat) async {
    final secret = chat['is_secret'] == true;
    final group = chat['is_group'] == true;
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
    _store.remove(chat['id'] as String);
    try {
      await deleteChat(chat['id'] as String, scope: secret ? 'everyone' : 'me');
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
      _store.load();
    }
  }

  Future<void> _toggleMute(Map<String, dynamic> chat) async {
    final id = chat['id'] as String;
    final next = chat['muted'] != true;
    _store.patch(id, {'muted': next});
    toast(context, next ? 'Notifications muted' : 'Notifications on');
    try {
      await setChatMute(id, next);
    } catch (_) {
      _store.patch(id, {'muted': !next});
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final me = Auth.instance.user;
    return Scaffold(
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 84),
        child: Pressable(
          onTap: () => showNewChatSheet(context),
          child: Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              gradient: p.gradient,
              borderRadius: BorderRadius.circular(22),
              boxShadow: [BoxShadow(color: p.primary.withValues(alpha: 0.45), blurRadius: 24, offset: const Offset(0, 10))],
            ),
            child: const Icon(Icons.edit_rounded, color: Colors.white, size: 26),
          ),
        ),
      ),
      body: ListenableBuilder(
        listenable: _store,
        builder: (context, _) {
          final list = _visible(me);
          return RefreshIndicator(
            edgeOffset: 120,
            onRefresh: () async {
              HapticFeedback.mediumImpact();
              await Future.wait([_store.load(), _store.loadAnnouncements(), ContactsStore.instance.load()]);
            },
            child: CustomScrollView(
              physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
              slivers: [
                SliverAppBar(
                  pinned: true,
                  expandedHeight: 116,
                  backgroundColor: p.bg.withValues(alpha: 0.92),
                  flexibleSpace: const FlexibleSpaceBar(
                    titlePadding: EdgeInsetsDirectional.only(start: 20, bottom: 14),
                    title: GradientText('Messages',
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.6)),
                    background: AuroraBackground(intensity: 0.45),
                  ),
                  actions: [
                    Padding(
                      padding: const EdgeInsets.only(right: 16),
                      child: UserAvatar(userId: me ?? '', size: 38),
                    ),
                  ],
                ),
                SliverToBoxAdapter(child: ConnectionBanner(status: _status)),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                    child: TextField(
                      controller: _search,
                      onChanged: (v) => setState(() => _query = v.trim()),
                      decoration: InputDecoration(
                        hintText: 'Search chats',
                        prefixIcon: const Icon(Icons.search_rounded),
                        suffixIcon: _query.isEmpty
                            ? null
                            : IconButton(
                                icon: const Icon(Icons.close_rounded),
                                onPressed: () => setState(() {
                                  _search.clear();
                                  _query = '';
                                }),
                              ),
                        contentPadding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                ),
                SliverToBoxAdapter(child: _filters()),
                if (_query.isEmpty && _filter == _Filter.all) SliverToBoxAdapter(child: _ContactsRail()),
                if (_store.announcements.isNotEmpty && _query.isEmpty)
                  SliverList.list(children: [
                    for (final a in _store.announcements) _AnnouncementCard(a),
                  ]),
                if (_store.error.isNotEmpty && _store.chats.isEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Text(errText(_store.error), style: TextStyle(color: p.danger)),
                    ),
                  ),
                if (_store.loading)
                  const SliverFillRemaining(child: Center(child: CircularProgressIndicator()))
                else if (list.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: EmptyState(
                      icon: _query.isNotEmpty ? Icons.search_off_rounded : Icons.forum_rounded,
                      title: _query.isNotEmpty
                          ? 'No matches'
                          : _filter == _Filter.all
                              ? 'No conversations yet'
                              : 'Nothing here',
                      message: _query.isNotEmpty
                          ? 'Try a different name.'
                          : 'Start a chat with someone from your contacts.',
                      action: _filter == _Filter.all && _query.isEmpty
                          ? SizedBox(
                              width: 220,
                              child: GradientButton(
                                  label: 'Start a chat',
                                  icon: Icons.add_rounded,
                                  onPressed: () => showNewChatSheet(context)))
                          : null,
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 180),
                    sliver: SliverList.builder(
                      itemCount: list.length,
                      itemBuilder: (_, i) => FadeSlideIn(
                        key: ValueKey(list[i]['id']),
                        index: i,
                        child: _ChatTile(
                          chat: list[i],
                          me: me,
                          onDelete: () => _delete(list[i]),
                          onMute: () => _toggleMute(list[i]),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _filters() {
    final p = context.p;
    final unread = _store.chats.where((c) => ((c['unread_count'] as int?) ?? 0) > 0).length;
    final items = [
      (_Filter.all, 'All', null),
      (_Filter.unread, 'Unread', unread > 0 ? '$unread' : null),
      (_Filter.groups, 'Groups', null),
      (_Filter.secret, 'Secret', null),
    ];
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: [
          for (final (f, label, count) in items)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Pressable(
                onTap: () => setState(() => _filter = f),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: _filter == f ? p.gradient : null,
                    color: _filter == f ? null : p.surfaceHigh,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Row(children: [
                    if (f == _Filter.secret) ...[
                      Icon(Icons.lock_rounded, size: 14, color: _filter == f ? Colors.white : p.subtext),
                      const SizedBox(width: 4),
                    ],
                    Text(label,
                        style: TextStyle(
                            color: _filter == f ? Colors.white : p.text,
                            fontWeight: FontWeight.w600,
                            fontSize: 13.5)),
                    if (count != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: _filter == f ? Colors.white.withValues(alpha: 0.25) : p.primary,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(count,
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ]),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/* -------------------------------------------------------------- contacts rail */

class _ContactsRail extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return ListenableBuilder(
      listenable: ContactsStore.instance,
      builder: (context, _) {
        final contacts = ContactsStore.instance.contacts;
        if (contacts.isEmpty) return const SizedBox.shrink();
        return SizedBox(
          height: 100,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: contacts.length,
            itemBuilder: (_, i) {
              final id = contacts[i]['id'] as String;
              return FadeSlideIn(
                index: i,
                child: Pressable(
                  onTap: () => openDirectChat(context, id),
                  child: SizedBox(
                    width: 74,
                    child: Column(children: [
                      const SizedBox(height: 6),
                      UserAvatar(userId: id, size: 56, ring: true),
                      const SizedBox(height: 6),
                      Text(id,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: p.text, fontSize: 12, fontWeight: FontWeight.w500)),
                    ]),
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }
}

/* --------------------------------------------------------------- announcements */

Color? _hex(String? s) {
  if (s == null) return null;
  final h = s.replaceAll('#', '');
  if (h.length != 6) return null;
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(0xff000000 | v);
}

class _AnnouncementCard extends StatelessWidget {
  const _AnnouncementCard(this.a);
  final Map<String, dynamic> a;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final base = _hex(a['color'] as String?) ?? p.primary;
    final fg = _hex(a['text_color'] as String?) ?? Colors.white;
    final icon = (a['icon'] as String?)?.trim();
    return FadeSlideIn(
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 6, 16, 6),
        padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [base, Color.lerp(base, Colors.black, 0.25)!]),
          borderRadius: BorderRadius.circular(22),
          boxShadow: [BoxShadow(color: base.withValues(alpha: 0.3), blurRadius: 18, offset: const Offset(0, 8))],
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(icon == null || icon.isEmpty ? '📢' : icon, style: const TextStyle(fontSize: 24)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if ('${a['title'] ?? ''}'.isNotEmpty)
                Text('${a['title']}', style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 15)),
              if ('${a['body'] ?? ''}'.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text('${a['body']}', style: TextStyle(color: fg.withValues(alpha: 0.9), height: 1.4)),
                ),
              if ('${a['author_label'] ?? ''}'.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('— ${a['author_label']}', style: TextStyle(color: fg.withValues(alpha: 0.75), fontSize: 12)),
                ),
            ]),
          ),
          if (a['dismissible'] != false)
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: Icon(Icons.close_rounded, color: fg),
              onPressed: () => ChatsStore.instance.dismissAnnouncement(a['id'] as int),
            ),
        ]),
      ),
    );
  }
}

/* ------------------------------------------------------------------ chat tile */

class _ChatTile extends StatelessWidget {
  const _ChatTile({required this.chat, required this.me, required this.onDelete, required this.onMute});
  final Map<String, dynamic> chat;
  final String? me;
  final VoidCallback onDelete;
  final VoidCallback onMute;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final title = chatTitle(chat, me);
    final unreadCount = (chat['unread_count'] as int?) ?? 0;
    final unread = unreadCount > 0;
    final isGroup = chat['is_group'] == true;
    final isSecret = chat['is_secret'] == true;
    final muted = chat['muted'] == true;
    final sender = chat['last_message_sender'] as String?;
    final last = chat['last_message'] as String?;
    final pending = isSecret && chat['e2e_status'] == 'pending';
    final timer = ((chat['self_destruct_seconds'] as int?) ?? 0) > 0;

    InlineSpan preview;
    final subStyle = TextStyle(
        color: unread ? p.text : p.subtext, fontWeight: unread ? FontWeight.w600 : FontWeight.w400, fontSize: 14);
    if (pending) {
      preview = TextSpan(
          text: chat['e2e_requested_by'] == me ? 'Waiting for them to accept…' : 'Wants to start a secret chat',
          style: subStyle.copyWith(color: p.secure, fontWeight: FontWeight.w600));
    } else if (chat['last_is_encrypted'] == true) {
      preview = TextSpan(children: [
        WidgetSpan(child: Icon(Icons.lock_rounded, size: 14, color: p.secure)),
        TextSpan(text: ' Encrypted message', style: subStyle),
      ]);
    } else if (last != null && last.isNotEmpty) {
      final prefix = chat['last_is_system'] == true
          ? ''
          : sender == me
              ? 'You: '
              : (isGroup && sender != null ? '$sender: ' : '');
      preview = TextSpan(children: [
        if (prefix.isNotEmpty) TextSpan(text: prefix, style: subStyle.copyWith(color: p.primary, fontWeight: FontWeight.w600)),
        TextSpan(text: last, style: subStyle),
      ]);
    } else {
      preview = TextSpan(text: 'No messages yet', style: subStyle.copyWith(fontStyle: FontStyle.italic));
    }

    return Dismissible(
      key: ValueKey('dismiss-${chat['id']}'),
      confirmDismiss: (dir) async {
        HapticFeedback.mediumImpact();
        if (dir == DismissDirection.startToEnd) {
          onMute();
        } else {
          onDelete();
        }
        return false;
      },
      background: _swipeBg(context, Alignment.centerLeft, muted ? Icons.notifications_active_rounded : Icons.notifications_off_rounded,
          muted ? 'Unmute' : 'Mute', LinearGradient(colors: [p.warn, const Color(0xfffbbf24)])),
      secondaryBackground: _swipeBg(context, Alignment.centerRight, Icons.delete_rounded, isGroup ? 'Leave' : 'Delete',
          LinearGradient(colors: [const Color(0xfffb7185), p.danger])),
      child: Pressable(
        scale: 0.98,
        onTap: () => openChat(context, chat),
        onLongPress: () => _menu(context),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: unread ? p.primary.withValues(alpha: p.dark ? 0.12 : 0.07) : Colors.transparent,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Row(children: [
            Hero(
              tag: 'avatar-${chat['id']}',
              child: UserAvatar(userId: title, size: 56, group: isGroup, ring: unread && !muted, secret: isSecret),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(
                    child: Text(title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: p.text, fontWeight: FontWeight.w700, fontSize: 16)),
                  ),
                  if (timer) ...[const SizedBox(width: 4), Icon(Icons.local_fire_department_rounded, size: 16, color: p.warn)],
                  if (muted) ...[const SizedBox(width: 4), Icon(Icons.notifications_off_rounded, size: 15, color: p.subtext)],
                  const Spacer(),
                  Text(relativeTime(chat['last_message_time'] as String?),
                      style: TextStyle(
                          fontSize: 12,
                          color: unread ? p.primary : p.subtext,
                          fontWeight: unread ? FontWeight.w700 : FontWeight.w400)),
                ]),
                const SizedBox(height: 4),
                Row(children: [
                  Expanded(child: Text.rich(preview, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  AnimatedScale(
                    scale: unread ? 1 : 0,
                    duration: const Duration(milliseconds: 250),
                    curve: Curves.easeOutBack,
                    child: unread
                        ? Padding(
                            padding: const EdgeInsets.only(left: 8),
                            child: GradientBadge(unreadCount > 99 ? '99+' : '$unreadCount', muted: muted),
                          )
                        : const SizedBox.shrink(),
                  ),
                ]),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _swipeBg(BuildContext context, Alignment align, IconData icon, String label, Gradient g) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 28),
      alignment: align,
      decoration: BoxDecoration(gradient: g, borderRadius: BorderRadius.circular(22)),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, color: Colors.white),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
      ]),
    );
  }

  void _menu(BuildContext context) {
    final muted = chat['muted'] == true;
    final group = chat['is_group'] == true;
    showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          SettingsTile(
            icon: Icons.chat_bubble_rounded,
            title: 'Open chat',
            onTap: () {
              Navigator.pop(c);
              openChat(context, chat);
            },
          ),
          SettingsTile(
            icon: muted ? Icons.notifications_active_rounded : Icons.notifications_off_rounded,
            title: muted ? 'Unmute notifications' : 'Mute notifications',
            gradient: LinearGradient(colors: [context.p.warn, const Color(0xfffbbf24)]),
            onTap: () {
              Navigator.pop(c);
              onMute();
            },
          ),
          SettingsTile(
            icon: group ? Icons.logout_rounded : Icons.delete_rounded,
            title: group ? 'Leave group' : 'Delete chat',
            destructive: true,
            onTap: () {
              Navigator.pop(c);
              onDelete();
            },
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }
}
