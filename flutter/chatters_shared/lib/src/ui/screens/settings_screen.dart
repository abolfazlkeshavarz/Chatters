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
import '../widgets/design.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _hasKey = false;
  bool _hasAvatar = false;
  String _visibility = 'public';
  String _email = '';
  int _bust = 0;
  bool _avatarBusy = false;

  String get _me => Auth.instance.user ?? '';
  final _s = AppSettings.instance;

  @override
  void initState() {
    super.initState();
    Keystore.load(_me).then((id) => mounted ? setState(() => _hasKey = id != null) : null);
    getMe().then((me) {
      if (!mounted) return;
      setState(() {
        _hasAvatar = me['has_avatar'] == true;
        _visibility = (me['avatar_visibility'] as String?) ?? 'public';
        _email = (me['email'] as String?) ?? '';
      });
    }).catchError((_) {});
  }

  Future<void> _avatarMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          SettingsTile(icon: Icons.photo_library_rounded, title: 'Choose from library', onTap: () => Navigator.pop(c, 'gallery')),
          SettingsTile(
              icon: Icons.photo_camera_rounded,
              title: 'Take a photo',
              gradient: const LinearGradient(colors: [Color(0xff2563eb), Color(0xff06b6d4)]),
              onTap: () => Navigator.pop(c, 'camera')),
          if (_hasAvatar)
            SettingsTile(icon: Icons.delete_rounded, title: 'Remove photo', destructive: true, onTap: () => Navigator.pop(c, 'remove')),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (choice == null) return;
    setState(() => _avatarBusy = true);
    try {
      if (choice == 'remove') {
        await deleteAvatar();
        _hasAvatar = false;
      } else {
        final x = await ImagePicker().pickImage(
            source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery, imageQuality: 88, maxWidth: 1024);
        if (x == null) return;
        await uploadAvatar(x.path);
        _hasAvatar = true;
      }
      _bust++;
      if (mounted) toast(context, choice == 'remove' ? 'Photo removed' : 'Looking good! Photo updated');
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    } finally {
      if (mounted) setState(() => _avatarBusy = false);
    }
  }

  Future<void> _setVisibility(String v) async {
    final prev = _visibility;
    setState(() => _visibility = v);
    try {
      await setAvatarVisibility(v);
    } catch (e) {
      setState(() => _visibility = prev);
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  Future<void> _changeUsername() async {
    final name = await promptText(context, 'Change username',
        hint: 'New username', ok: 'Update', icon: Icons.alternate_email_rounded);
    if (name == null || name.trim().isEmpty) return;
    try {
      await changeUsername(name.trim());
      if (!mounted) return;
      await confirm(context, 'Username updated', 'Please sign in again with your new username.',
          ok: 'Sign in again', icon: Icons.check_rounded);
      await Auth.instance.logout();
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  Future<void> _changePassword() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PasswordSheet(hasKey: _hasKey),
    );
    if (changed == true) await Auth.instance.logout();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      body: ListenableBuilder(
        listenable: _s,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.only(bottom: 140),
          physics: const BouncingScrollPhysics(),
          children: [
            _header(p),
            SectionCard(title: 'Appearance', children: [
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Theme', style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 10),
                  Row(children: [
                    for (final (m, icon, label) in [
                      (ThemeMode.system, Icons.brightness_auto_rounded, 'Auto'),
                      (ThemeMode.light, Icons.light_mode_rounded, 'Light'),
                      (ThemeMode.dark, Icons.dark_mode_rounded, 'Dark'),
                    ])
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: Pressable(
                            onTap: () => _s.setMode(m),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 250),
                              height: 70,
                              decoration: BoxDecoration(
                                gradient: _s.mode == m ? p.gradient : null,
                                color: _s.mode == m ? null : p.surfaceHigh,
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                                Icon(icon, color: _s.mode == m ? Colors.white : p.subtext),
                                const SizedBox(height: 4),
                                Text(label,
                                    style: TextStyle(
                                        color: _s.mode == m ? Colors.white : p.text,
                                        fontWeight: FontWeight.w600,
                                        fontSize: 13)),
                              ]),
                            ),
                          ),
                        ),
                      ),
                  ]),
                  const SizedBox(height: 18),
                  Row(children: [
                    Text('Accent', style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                    const Spacer(),
                    Text(_s.accent.name, style: TextStyle(color: p.primary, fontWeight: FontWeight.w700)),
                  ]),
                  const SizedBox(height: 12),
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    for (var i = 0; i < accents.length; i++)
                      Pressable(
                        onTap: () => _s.setAccent(i),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          width: 50,
                          height: 50,
                          padding: const EdgeInsets.all(3),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: _s.accentIndex == i ? p.text : Colors.transparent, width: 2.5),
                          ),
                          child: Container(
                            decoration: BoxDecoration(gradient: accents[i].gradient, shape: BoxShape.circle),
                            child: AnimatedScale(
                              scale: _s.accentIndex == i ? 1 : 0,
                              duration: const Duration(milliseconds: 250),
                              curve: Curves.easeOutBack,
                              child: const Icon(Icons.check_rounded, color: Colors.white),
                            ),
                          ),
                        ),
                      ),
                  ]),
                ]),
              ),
              SettingsTile(
                icon: Icons.wallpaper_rounded,
                title: 'Chat wallpaper',
                subtitle: 'Soft gradient pattern behind messages',
                trailing: Switch(value: _s.wallpaper, onChanged: _s.setWallpaper),
              ),
            ]),
            SectionCard(title: 'Privacy & security', children: [
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const GradientIcon(Icons.visibility_rounded, size: 36),
                    const SizedBox(width: 14),
                    Text('Who sees my photo', style: TextStyle(color: p.text, fontWeight: FontWeight.w600, fontSize: 15.5)),
                  ]),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<String>(
                      showSelectedIcon: false,
                      segments: const [
                        ButtonSegment(value: 'public', label: Text('Everyone'), icon: Icon(Icons.public_rounded)),
                        ButtonSegment(value: 'contacts', label: Text('Contacts'), icon: Icon(Icons.people_rounded)),
                      ],
                      selected: {_visibility},
                      onSelectionChanged: (s) => _setVisibility(s.first),
                    ),
                  ),
                ]),
              ),
              SettingsTile(
                icon: _hasKey ? Icons.verified_user_rounded : Icons.gpp_maybe_rounded,
                title: 'End-to-end encryption',
                subtitle: _hasKey ? 'Your key is safely stored on this device' : 'No key on this device — sign in again',
                gradient: _hasKey ? p.secureGradient : LinearGradient(colors: [p.warn, const Color(0xfffbbf24)]),
              ),
            ]),
            SectionCard(title: 'Account', children: [
              SettingsTile(icon: Icons.alternate_email_rounded, title: 'Change username', onTap: _changeUsername),
              SettingsTile(
                icon: Icons.key_rounded,
                title: 'Change password',
                gradient: const LinearGradient(colors: [Color(0xfff97316), Color(0xffe11d48)]),
                onTap: _changePassword,
              ),
            ]),
            SectionCard(title: 'About', children: [
              SettingsTile(
                icon: Icons.dns_rounded,
                title: 'Server',
                subtitle: apiBase.replaceFirst(RegExp(r'^https?://'), ''),
                gradient: const LinearGradient(colors: [Color(0xff2563eb), Color(0xff06b6d4)]),
              ),
              SettingsTile(
                icon: Icons.logout_rounded,
                title: 'Sign out',
                destructive: true,
                onTap: () async {
                  if (await confirm(context, 'Sign out?',
                      'Your encryption key is removed from this device. Sign in again to read secret chats.',
                      ok: 'Sign out', destructive: true, icon: Icons.logout_rounded)) {
                    await Auth.instance.logout();
                  }
                },
              ),
            ]),
            const SizedBox(height: 24),
            Center(child: Text('Chatters · made with 💜', style: TextStyle(color: p.subtext, fontSize: 12))),
          ],
        ),
      ),
    );
  }

  Widget _header(Palette p) {
    return SizedBox(
      height: 330,
      child: AuroraBackground(
        intensity: 1.1,
        child: SafeArea(
          bottom: false,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Pressable(
              onTap: _avatarBusy ? null : _avatarMenu,
              child: Stack(clipBehavior: Clip.none, children: [
                Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: p.primary.withValues(alpha: 0.45), blurRadius: 36, offset: const Offset(0, 14))],
                  ),
                  child: UserAvatar(userId: _me, size: 112, bust: _bust, ring: true),
                ),
                Positioned(
                  right: 0,
                  bottom: 4,
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      gradient: p.gradient,
                      shape: BoxShape.circle,
                      border: Border.all(color: p.bg, width: 3),
                    ),
                    child: _avatarBusy
                        ? const Padding(
                            padding: EdgeInsets.all(8),
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 17),
                  ),
                ),
              ]),
            ),
            const SizedBox(height: 16),
            Text(_me, style: TextStyle(color: p.text, fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
            if (_email.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(_email, style: TextStyle(color: p.subtext)),
              ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: (_hasKey ? p.secure : p.warn).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(_hasKey ? Icons.lock_rounded : Icons.lock_open_rounded,
                    size: 14, color: _hasKey ? p.secure : p.warn),
                const SizedBox(width: 6),
                Text(_hasKey ? 'Encryption ready' : 'Encryption key missing',
                    style: TextStyle(color: _hasKey ? p.secure : p.warn, fontWeight: FontWeight.w700, fontSize: 12.5)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class _PasswordSheet extends StatefulWidget {
  const _PasswordSheet({required this.hasKey});
  final bool hasKey;
  @override
  State<_PasswordSheet> createState() => _PasswordSheetState();
}

class _PasswordSheetState extends State<_PasswordSheet> {
  final _old = TextEditingController();
  final _new = TextEditingController();
  bool _busy = false;
  String _error = '';

  Future<void> _save() async {
    if (_old.text.isEmpty || _new.text.isEmpty) return setState(() => _error = 'Fill in both fields');
    if (_new.text.length < 8) return setState(() => _error = 'At least 8 characters');
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      Map<String, dynamic>? keys;
      try {
        // Re-wrap with a fresh key pair, as the web client does.
        if (widget.hasKey) keys = await wrapIdentity(generateIdentity(), _new.text);
      } catch (_) {}
      await changePassword(_old.text, _new.text, keys);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.of(context).viewInsets.bottom + 24),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Change password', style: TextStyle(color: p.text, fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text('You will be signed out afterwards.', style: TextStyle(color: p.subtext)),
        const SizedBox(height: 16),
        TextField(
            controller: _old,
            obscureText: true,
            decoration: const InputDecoration(hintText: 'Current password', prefixIcon: Icon(Icons.lock_outline_rounded))),
        const SizedBox(height: 12),
        TextField(
            controller: _new,
            obscureText: true,
            onSubmitted: (_) => _save(),
            decoration: const InputDecoration(hintText: 'New password', prefixIcon: Icon(Icons.key_rounded))),
        if (_error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error, style: TextStyle(color: p.danger))),
        const SizedBox(height: 16),
        GradientButton(label: 'Update password', busy: _busy, onPressed: _save),
      ]),
    );
  }
}
