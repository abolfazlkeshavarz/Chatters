import 'dart:async';

import 'package:flutter/material.dart';

import '../../api/endpoints.dart';
import '../../services/auth.dart';
import '../theme.dart';
import '../widgets/common.dart';

const _pageSize = 25;
const _retentionPresets = [
  ('Never', 0),
  ('12 hours', 12 * 3600),
  ('1 day', 24 * 3600),
  ('3 days', 3 * 24 * 3600),
  ('7 days', 7 * 24 * 3600),
];

class AdminScreen extends StatefulWidget {
  const AdminScreen({super.key});
  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  Map<String, dynamic> _stats = {};
  List<Map<String, dynamic>> _users = [];
  int _total = 0;
  int _page = 0;
  String _search = '';
  bool _loading = true;
  String _error = '';
  int? _retention;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _refresh();
    adminGetE2ERetention().then((r) => mounted ? setState(() => _retention = r) : null).catchError((e) {
      if (mounted) setState(() => _error = e.toString());
      return null;
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final results = await Future.wait([
        adminStats(),
        adminListUsers(search: _search, limit: _pageSize, offset: _page * _pageSize),
      ]);
      if (!mounted) return;
      setState(() {
        _stats = results[0];
        _users = ((results[1]['users'] as List?) ?? []).cast<Map<String, dynamic>>();
        _total = (results[1]['total'] as int?) ?? 0;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _act(Future<void> Function() fn, String done) async {
    try {
      await fn();
      if (mounted) toast(context, done);
      _refresh();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _createUser() async {
    final u = TextEditingController(), e = TextEditingController(), pw = TextEditingController();
    var admin = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Create user'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: u, decoration: const InputDecoration(labelText: 'Username')),
            const SizedBox(height: 8),
            TextField(controller: e, decoration: const InputDecoration(labelText: 'Email')),
            const SizedBox(height: 8),
            TextField(controller: pw, obscureText: true, decoration: const InputDecoration(labelText: 'Password (min 8)')),
            CheckboxListTile(value: admin, onChanged: (v) => set(() => admin = v == true), title: const Text('Administrator')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Create')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await _act(() => adminCreateUser(u.text.trim(), e.text.trim(), pw.text, admin), 'Created ${u.text.trim()}');
  }

  Future<void> _userMenu(Map<String, dynamic> user) async {
    final id = user['id'] as String;
    final isAdmin = user['is_admin'] == true;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(id, style: const TextStyle(fontWeight: FontWeight.w700))),
          ListTile(leading: const Icon(Icons.key), title: const Text('Reset password'), onTap: () => Navigator.pop(c, 'reset')),
          if (id != Auth.instance.user)
            ListTile(
              leading: const Icon(Icons.shield_outlined),
              title: Text(isAdmin ? 'Make regular user' : 'Make administrator'),
              onTap: () => Navigator.pop(c, 'role'),
            ),
          if (id != Auth.instance.user)
            ListTile(
              leading: Icon(Icons.delete_outline, color: context.p.danger),
              title: Text('Delete user', style: TextStyle(color: context.p.danger)),
              onTap: () => Navigator.pop(c, 'delete'),
            ),
        ]),
      ),
    );
    if (!mounted || choice == null) return;
    switch (choice) {
      case 'reset':
        final pw = await promptText(context, 'Reset password for $id', hint: 'New password (min 8)', obscure: true);
        if (pw == null) return;
        if (pw.length < 8) return setState(() => _error = 'Password too short');
        await _act(() => adminResetPassword(id, pw), 'Password reset for $id');
      case 'role':
        await _act(() => adminSetRole(id, !isAdmin), '$id is now ${!isAdmin ? 'an administrator' : 'a regular user'}');
      case 'delete':
        if (await confirm(context, 'Delete "$id"?',
            'Their messages, memberships and keys are removed. This cannot be undone.', ok: 'Delete', destructive: true)) {
          await _act(() => adminDeleteUser(id), 'Deleted $id');
        }
    }
  }

  Future<void> _changeRetention(int s) async {
    setState(() => _retention = s);
    final label = _retentionPresets.where((x) => x.$2 == s).map((x) => x.$1).firstOrNull ?? '${s}s';
    await _act(() => adminSetE2ERetention(s), 'Encrypted-chat auto-delete: $label');
  }

  Future<void> _purge() async {
    if (await confirm(context, 'Delete all encrypted messages?',
        'Every end-to-end encrypted message on the server is deleted now. This cannot be undone.',
        ok: 'Delete all', destructive: true)) {
      await _act(() async => adminPurgeE2E(), 'Encrypted messages purged');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final pages = (_total / _pageSize).ceil();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [IconButton(icon: const Icon(Icons.person_add_alt), onPressed: _createUser)],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error, style: TextStyle(color: p.danger))),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _stats.entries
                .where((e) => e.value is num)
                .map((e) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(12), border: Border.all(color: p.border, width: 0.5)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${e.value}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: p.text)),
                        Text(e.key.replaceAll('_', ' '), style: TextStyle(fontSize: 12, color: p.subtext)),
                      ]),
                    ))
                .toList(),
          ),
          const SizedBox(height: 16),
          Text('Encrypted-chat auto-delete', style: TextStyle(color: p.subtext, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, children: [
            for (final (label, s) in _retentionPresets)
              ChoiceChip(label: Text(label), selected: _retention == s, onSelected: (_) => _changeRetention(s)),
          ]),
          TextButton(onPressed: _purge, child: Text('Delete all encrypted messages now', style: TextStyle(color: p.danger))),
          const SizedBox(height: 8),
          TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search users'),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 300), () {
                _search = v.trim();
                _page = 0;
                _refresh();
              });
            },
          ),
          const SizedBox(height: 8),
          if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          ..._users.map((u) => Card(
                margin: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  title: Text('${u['id']}${u['is_admin'] == true ? '  · admin' : ''}'),
                  subtitle: Text('${u['email'] ?? ''}'),
                  trailing: const Icon(Icons.more_vert),
                  onTap: () => _userMenu(u),
                ),
              )),
          if (pages > 1)
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton(icon: const Icon(Icons.chevron_left), onPressed: _page > 0 ? () { _page--; _refresh(); } : null),
              Text('${_page + 1} / $pages'),
              IconButton(icon: const Icon(Icons.chevron_right), onPressed: _page + 1 < pages ? () { _page++; _refresh(); } : null),
            ]),
        ]),
      ),
    );
  }
}
