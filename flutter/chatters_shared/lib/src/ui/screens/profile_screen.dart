import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/endpoints.dart';
import '../../config.dart';
import '../../crypto/e2ee.dart';
import '../../crypto/keystore.dart';
import '../../services/auth.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _newUsername = TextEditingController();
  final _oldPw = TextEditingController();
  final _newPw = TextEditingController();
  bool _hasKey = false;
  bool _hasAvatar = false;
  String _visibility = 'public';
  int _bust = 0;
  bool _busy = false;
  String _error = '';
  String _message = '';

  String get _me => Auth.instance.user ?? '';

  @override
  void initState() {
    super.initState();
    Keystore.load(_me).then((id) => mounted ? setState(() => _hasKey = id != null) : null);
    getMe().then((me) {
      if (!mounted) return;
      setState(() {
        _hasAvatar = me['has_avatar'] == true;
        _visibility = (me['avatar_visibility'] as String?) ?? 'public';
      });
    }).catchError((_) {});
  }

  void _note(String m) => setState(() {
        _message = m;
        _error = '';
      });

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = '';
      _message = '';
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickAvatar() async {
    final x = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1024);
    if (x == null) return;
    await _run(() async {
      await uploadAvatar(x.path);
      _hasAvatar = true;
      _bust++;
      _note('Profile photo updated');
    });
  }

  Future<void> _removeAvatar() => _run(() async {
        await deleteAvatar();
        _hasAvatar = false;
        _bust++;
        _note('Profile photo removed');
      });

  Future<void> _changeVisibility(String v) async {
    final prev = _visibility;
    setState(() => _visibility = v);
    try {
      await setAvatarVisibility(v);
    } catch (e) {
      setState(() {
        _visibility = prev;
        _error = e.toString();
      });
    }
  }

  Future<void> _changeUsername() async {
    final name = _newUsername.text.trim();
    if (name.isEmpty) return setState(() => _error = 'Please enter a new username');
    await _run(() async {
      await changeUsername(name);
      if (!mounted) return;
      await showDialog(
          context: context,
          builder: (c) => AlertDialog(title: const Text('Username updated'), content: const Text('Please sign in again.'),
              actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))]));
      await Auth.instance.logout();
    });
  }

  Future<void> _changePassword() async {
    if (_oldPw.text.isEmpty || _newPw.text.isEmpty) return setState(() => _error = 'Please fill both password fields');
    if (_newPw.text.length < 8) return setState(() => _error = 'New password must be at least 8 characters');
    await _run(() async {
      Map<String, dynamic>? keys;
      try {
        // The server re-wraps with a fresh key pair on password change, as the
        // web and React Native clients do.
        if (_hasKey) keys = await wrapIdentity(generateIdentity(), _newPw.text);
      } catch (_) {}
      await changePassword(_oldPw.text, _newPw.text, keys);
      if (!mounted) return;
      await showDialog(
          context: context,
          builder: (c) => AlertDialog(title: const Text('Password updated'), content: const Text('Please sign in again.'),
              actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('OK'))]));
      await Auth.instance.logout();
    });
  }

  Widget _section(String title, List<Widget> children) {
    final p = context.p;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: p.border, width: 0.5)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(title.toUpperCase(), style: TextStyle(color: p.subtext, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
        const SizedBox(height: 12),
        ...children,
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile', style: TextStyle(fontWeight: FontWeight.w700))),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        if (_message.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_message, style: TextStyle(color: p.success))),
        if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error, style: TextStyle(color: p.danger))),
        _section('Account', [
          Row(children: [
            UserAvatar(userId: _me, size: 64, bust: _bust),
            const SizedBox(width: 16),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_me, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: p.text)),
                Text(_hasKey ? '🔒 Encryption key on this device' : '⚠️ No encryption key on this device',
                    style: TextStyle(fontSize: 12, color: _hasKey ? p.secure : p.subtext)),
              ]),
            ),
          ]),
          const SizedBox(height: 12),
          Wrap(spacing: 8, children: [
            OutlinedButton(onPressed: _busy ? null : _pickAvatar, child: Text(_hasAvatar ? 'Change photo' : 'Add photo')),
            if (_hasAvatar) TextButton(onPressed: _busy ? null : _removeAvatar, child: Text('Remove', style: TextStyle(color: p.danger))),
          ]),
          const SizedBox(height: 8),
          Text('Who can see my photo', style: TextStyle(color: p.subtext, fontSize: 13)),
          const SizedBox(height: 6),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'public', label: Text('Everyone')),
              ButtonSegment(value: 'contacts', label: Text('Contacts')),
            ],
            selected: {_visibility},
            onSelectionChanged: (s) => _changeVisibility(s.first),
          ),
        ]),
        _section('Change username', [
          TextField(controller: _newUsername, autocorrect: false, decoration: const InputDecoration(labelText: 'New username')),
          const SizedBox(height: 10),
          PrimaryButton(label: 'Update username', busy: _busy, onPressed: _changeUsername),
        ]),
        _section('Change password', [
          TextField(controller: _oldPw, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
          const SizedBox(height: 10),
          TextField(controller: _newPw, obscureText: true, decoration: const InputDecoration(labelText: 'New password')),
          const SizedBox(height: 10),
          PrimaryButton(label: 'Update password', busy: _busy, onPressed: _changePassword),
        ]),
        _section('Session', [
          Text('Server: $apiBase', style: TextStyle(color: p.subtext, fontSize: 12)),
          const SizedBox(height: 10),
          PrimaryButton(
            label: 'Sign out',
            color: p.danger,
            onPressed: () async {
              if (await confirm(context, 'Sign out?', 'Your encryption key is removed from this device.', ok: 'Sign out', destructive: true)) {
                await Auth.instance.logout();
              }
            },
          ),
        ]),
      ]),
    );
  }
}
