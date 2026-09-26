import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../api/endpoints.dart';
import '../../services/auth.dart';
import '../../services/chat_socket.dart';
import '../../services/notifications.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/connection_banner.dart';
import 'chat_screen.dart';

String chatTitle(Map<String, dynamic> chat, String? me) {
  final others = ((chat['members'] as List?) ?? []).cast<String>().where((u) => u != me).toList();
  if (chat['is_group'] == true) {
    final name = chat['name'] as String?;
    return (name != null && name.isNotEmpty) ? name : (others.isEmpty ? 'Group' : others.join(', '));
  }
  return others.isNotEmpty ? others.first : 'Saved messages';
}

String _formatTime(String? ts) {
  final d = ts == null ? null : DateTime.tryParse(ts)?.toLocal();
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inDays == 0) return DateFormat.Hm().format(d);
  if (diff.inDays == 1) return 'Yesterday';
  if (diff.inDays < 7) return DateFormat.E().format(d);
  return DateFormat.MMMd().format(d);
}

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});
  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  List<Map<String, dynamic>> _chats = [];
  List<Map<String, dynamic>> _contacts = [];
  bool _loading = true;
  String _error = '';
  SocketStatus _status = ChatSocket.instance.status;
  final List<StreamSubscription> _subs = [];
  Timer? _debounce;

  static const _refreshTypes = {
    'message', 'media', 'deleted', 'chat_deleted', 'e2e_request', 'e2e_accepted', 'e2e_rejected', 'timer',
  };

  @override
  void initState() {
    super.initState();
    _load();
    _loadContacts();
    _subs.add(ChatSocket.instance.messages.listen((m) {
      if (_refreshTypes.contains(m['type'])) _scheduleLoad();
    }));
    _subs.add(ChatSocket.instance.reconnected.listen((_) => _load()));
    _subs.add(ChatSocket.instance.statusStream.listen((s) => setState(() => _status = s)));
  }

  void _scheduleLoad() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _load);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    try {
      final list = await getChats();
      Notifications.instance.mutedChats
        ..clear()
        ..addAll(list.where((c) => c['muted'] == true).map((c) => c['id'] as String));
      if (mounted) {
        setState(() {
          _chats = list;
          _error = '';
        });
      }
      return list;
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
      return [];
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadContacts() async {
    try {
      final c = await getContacts();
      if (mounted) setState(() => _contacts = c);
    } catch (_) {}
  }

  Future<void> _open(Map<String, dynamic> chat) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(chat: chat)));
    _load();
  }

  Future<void> _confirmDelete(Map<String, dynamic> chat) async {
    final secret = chat['is_secret'] == true;
    final group = chat['is_group'] == true;
    final ok = await confirm(
      context,
      group ? 'Leave group?' : 'Delete chat?',
      secret
          ? 'This deletes the secret chat for both of you. Cannot be undone.'
          : group
              ? 'You will stop receiving its messages.'
              : 'Removes it from your list. The other person keeps their copy.',
      ok: group ? 'Leave' : 'Delete',
      destructive: true,
    );
    if (!ok) return;
    setState(() => _chats.removeWhere((c) => c['id'] == chat['id']));
    try {
      await deleteChat(chat['id'] as String, scope: secret ? 'everyone' : 'me');
    } catch (_) {
      _load();
    }
  }

  Future<void> _create(List<String> members, {bool group = false, String name = '', bool secret = false}) async {
    final res = secret ? await createSecretChat(members.first) : await createChat(members, group, name);
    final id = res['chat_id'];
    final fresh = await _load();
    if (!mounted) return;
    Navigator.pop(context);
    final created = fresh.where((c) => c['id'] == id).firstOrNull;
    if (created != null) _open(created);
  }

  void _showMenu() {
    _loadContacts();
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Text('👤', style: TextStyle(fontSize: 20)), title: const Text('Contacts'),
              onTap: () { Navigator.pop(c); _showContacts(); }),
          ListTile(leading: const Text('💬', style: TextStyle(fontSize: 20)), title: const Text('New chat'),
              onTap: () { Navigator.pop(c); _pickContacts('direct'); }),
          ListTile(leading: const Text('🔒', style: TextStyle(fontSize: 20)), title: const Text('New secret chat'),
              onTap: () { Navigator.pop(c); _pickContacts('secret'); }),
          ListTile(leading: const Text('👥', style: TextStyle(fontSize: 20)), title: const Text('New group'),
              onTap: () { Navigator.pop(c); _pickContacts('group'); }),
        ]),
      ),
    );
  }

  void _showContacts() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => _ContactsSheet(
        contacts: _contacts,
        onChanged: () async {
          await _loadContacts();
          return _contacts;
        },
      ),
    );
  }

  void _pickContacts(String mode) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => _PickSheet(
        mode: mode,
        contacts: _contacts,
        onAddContact: () {
          Navigator.pop(c);
          _showContacts();
        },
        onCreate: (members, name) =>
            _create(members, group: mode == 'group', name: name, secret: mode == 'secret'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final me = Auth.instance.user;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Chats', style: TextStyle(fontWeight: FontWeight.w700)),
          Text('Logged in as $me', style: TextStyle(fontSize: 12, color: p.subtext)),
        ]),
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: p.primary,
        foregroundColor: Colors.white,
        onPressed: _showMenu,
        child: const Icon(Icons.edit),
      ),
      body: Column(children: [
        ConnectionBanner(status: _status),
        if (_error.isNotEmpty)
          Padding(padding: const EdgeInsets.all(12), child: Text(_error, style: TextStyle(color: p.danger))),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: () async {
                    await Future.wait([_load(), _loadContacts()]);
                  },
                  child: _chats.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          const Center(child: Text('💬', style: TextStyle(fontSize: 40))),
                          Center(child: Text('No chats yet', style: TextStyle(color: p.subtext))),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                          itemCount: _chats.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) => _chatTile(_chats[i], me),
                        ),
                ),
        ),
      ]),
    );
  }

  Widget _chatTile(Map<String, dynamic> chat, String? me) {
    final p = context.p;
    final title = chatTitle(chat, me);
    final unreadCount = (chat['unread_count'] as int?) ?? 0;
    final unread = unreadCount > 0;
    final isGroup = chat['is_group'] == true;
    final isSecret = chat['is_secret'] == true;
    final sender = chat['last_message_sender'] as String?;
    final last = chat['last_message'] as String?;

    String preview;
    if (chat['last_is_encrypted'] == true) {
      preview = '🔒 Encrypted message';
    } else if (last != null && last.isNotEmpty) {
      final prefix = chat['last_is_system'] == true
          ? ''
          : sender == me
              ? 'You: '
              : (isGroup && sender != null ? '$sender: ' : '');
      preview = prefix + last;
    } else {
      preview = 'No messages yet';
    }

    final flags = [
      if (isSecret) 'secret' else if (isGroup) 'group',
    ].join();

    return Material(
      color: unread ? p.unreadBg : p.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: p.border, width: 0.5)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _open(chat),
        onLongPress: () => _confirmDelete(chat),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            isGroup
                ? CircleAvatar(
                    radius: 23,
                    backgroundColor: p.primary,
                    child: Text(title.isEmpty ? '?' : title.characters.first.toUpperCase(),
                        style: const TextStyle(color: Colors.white, fontSize: 18)),
                  )
                : UserAvatar(userId: title, size: 46),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: Text(
                      '${chat['e2e_enabled'] == true || isSecret ? '🔒 ' : ''}$title'
                      '${flags.isNotEmpty ? '  ·  $flags' : ''}'
                      '${((chat['self_destruct_seconds'] as int?) ?? 0) > 0 ? '  🔥' : ''}'
                      '${chat['muted'] == true ? '  🔕' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: p.text, fontWeight: FontWeight.w500),
                    ),
                  ),
                  Text(_formatTime(chat['last_message_time'] as String?),
                      style: TextStyle(fontSize: 12, color: p.subtext)),
                ]),
                if (isSecret && chat['e2e_status'] == 'pending')
                  Text(
                    chat['e2e_requested_by'] == me
                        ? '🔒 Waiting for them to accept…'
                        : '🔒 Wants to start a secret chat — tap to respond',
                    style: TextStyle(fontSize: 12, color: p.secure),
                  ),
                const SizedBox(height: 2),
                Row(children: [
                  Expanded(
                    child: Text(preview,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 13,
                            color: unread ? p.text : p.subtext,
                            fontWeight: unread ? FontWeight.w600 : FontWeight.w400)),
                  ),
                  if (unread)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: p.primary, borderRadius: BorderRadius.circular(10)),
                      child: Text(unreadCount > 9 ? '9+' : '$unreadCount',
                          style: const TextStyle(color: Colors.white, fontSize: 12)),
                    ),
                ]),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/* ------------------------------------------------------------ sheets */

class _ContactsSheet extends StatefulWidget {
  const _ContactsSheet({required this.contacts, required this.onChanged});
  final List<Map<String, dynamic>> contacts;
  final Future<List<Map<String, dynamic>>> Function() onChanged;
  @override
  State<_ContactsSheet> createState() => _ContactsSheetState();
}

class _ContactsSheetState extends State<_ContactsSheet> {
  late List<Map<String, dynamic>> _contacts = widget.contacts;
  final _ctl = TextEditingController();
  bool _busy = false;
  String _err = '';

  Future<void> _add() async {
    final name = _ctl.text.trim();
    if (name.isEmpty) return;
    setState(() {
      _busy = true;
      _err = '';
    });
    try {
      await addContact(name);
      _ctl.clear();
      _contacts = await widget.onChanged();
    } catch (e) {
      _err = e.toString();
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _remove(String id) async {
    try {
      await removeContact(id);
      _contacts = await widget.onChanged();
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) setState(() => _err = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Contacts', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.text)),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _ctl,
              autocorrect: false,
              onSubmitted: (_) => _add(),
              decoration: const InputDecoration(hintText: 'Add by username or phone'),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(onPressed: _busy ? null : _add, child: const Text('Add')),
        ]),
        if (_err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err, style: TextStyle(color: p.danger))),
        const SizedBox(height: 8),
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 320),
          child: _contacts.isEmpty
              ? Padding(padding: const EdgeInsets.all(16), child: Text('No contacts yet.', style: TextStyle(color: p.subtext)))
              : ListView(
                  shrinkWrap: true,
                  children: _contacts
                      .map((c) => ListTile(
                            leading: UserAvatar(userId: c['id'] as String, size: 36),
                            title: Text(c['id'] as String),
                            trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => _remove(c['id'] as String)),
                          ))
                      .toList(),
                ),
        ),
      ]),
    );
  }
}

class _PickSheet extends StatefulWidget {
  const _PickSheet({required this.mode, required this.contacts, required this.onCreate, required this.onAddContact});
  final String mode;
  final List<Map<String, dynamic>> contacts;
  final Future<void> Function(List<String> members, String name) onCreate;
  final VoidCallback onAddContact;
  @override
  State<_PickSheet> createState() => _PickSheetState();
}

class _PickSheetState extends State<_PickSheet> {
  final _name = TextEditingController();
  final Set<String> _selected = {};
  bool _busy = false;
  String _err = '';

  Future<void> _go(List<String> members) async {
    setState(() {
      _busy = true;
      _err = '';
    });
    try {
      await widget.onCreate(members, _name.text.trim());
    } catch (e) {
      if (mounted) {
        setState(() {
          _err = e.toString();
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final group = widget.mode == 'group';
    final title = group ? 'New group' : widget.mode == 'secret' ? '🔒 New secret chat' : 'New chat';
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(title, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.text)),
        const SizedBox(height: 12),
        if (group) ...[
          TextField(controller: _name, decoration: const InputDecoration(hintText: 'Group name (optional)')),
          const SizedBox(height: 8),
        ],
        if (widget.contacts.isEmpty)
          Center(child: FilledButton(onPressed: widget.onAddContact, child: const Text('👤  Add a contact')))
        else
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 340),
            child: ListView(
              shrinkWrap: true,
              children: widget.contacts.map((c) {
                final id = c['id'] as String;
                final sel = _selected.contains(id);
                return ListTile(
                  enabled: !_busy,
                  tileColor: sel ? p.unreadBg : null,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  leading: UserAvatar(userId: id, size: 36),
                  title: Text(id),
                  trailing: group ? Icon(sel ? Icons.check_box : Icons.check_box_outline_blank) : null,
                  onTap: () {
                    if (!group) {
                      _go([id]);
                      return;
                    }
                    setState(() => sel ? _selected.remove(id) : _selected.add(id));
                  },
                );
              }).toList(),
            ),
          ),
        if (_err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err, style: TextStyle(color: p.danger))),
        if (group) ...[
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _selected.isEmpty || _busy ? null : () => _go(_selected.toList()),
            child: Text('Create (${_selected.length})'),
          ),
        ],
      ]),
    );
  }
}
