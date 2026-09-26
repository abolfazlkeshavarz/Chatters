import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/auth.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';
import '../l10n.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _user = TextEditingController();
  final _email = TextEditingController();
  final _pass = TextEditingController();
  final _pass2 = TextEditingController();
  bool _busy = false;
  bool _hide = true;
  String _error = '';
  String _done = '';

  @override
  void initState() {
    super.initState();
    _pass.addListener(() => setState(() {}));
  }

  /// 0..4, shown as a gradient strength meter.
  int get _strength {
    final s = _pass.text;
    var n = 0;
    if (s.length >= 8) n++;
    if (s.length >= 12) n++;
    if (RegExp(r'[A-Z]').hasMatch(s) && RegExp(r'[a-z]').hasMatch(s)) n++;
    if (RegExp(r'[0-9]').hasMatch(s) && RegExp(r'[^A-Za-z0-9]').hasMatch(s)) n++;
    return n;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    String? err;
    if (_user.text.trim().isEmpty || _email.text.trim().isEmpty || _pass.text.isEmpty) {
      err = t('Please fill in every field');
    } else if (_pass.text.length < 8) {
      err = t('Password must be at least 8 characters');
    } else if (_pass.text != _pass2.text) {
      err = t('Passwords do not match');
    }
    if (err != null) {
      HapticFeedback.heavyImpact();
      return setState(() => _error = err!);
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final res = await Auth.instance.register(_user.text.trim(), _email.text.trim(), _pass.text);
      HapticFeedback.lightImpact();
      setState(() => _done = (res['message'] as String?) ??
          t('Your request was submitted and is waiting for an administrator to approve it.'));
    } catch (e) {
      setState(() => _error = errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final labels = [t('Too short'), t('Weak'), t('Okay'), t('Strong'), t('Excellent')];
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(),
      body: AuroraBackground(
        intensity: 0.8,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 400),
                  child: _done.isNotEmpty
                      ? Column(key: const ValueKey('done'), children: [
                          GradientIcon(Icons.mark_email_read_rounded, size: 96, radius: 32, gradient: p.secureGradient),
                          const SizedBox(height: 24),
                          Text(t('Request sent'),
                              style: TextStyle(color: p.text, fontSize: 26, fontWeight: FontWeight.w800)),
                          const SizedBox(height: 10),
                          Text(_done, textAlign: TextAlign.center, style: TextStyle(color: p.subtext, height: 1.5)),
                          const SizedBox(height: 28),
                          GradientButton(label: t('Back to sign in'), onPressed: () => Navigator.pop(context)),
                        ])
                      : Column(key: const ValueKey('form'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Text(t('Create your account'),
                              style: TextStyle(color: p.text, fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                          const SizedBox(height: 6),
                          Text(t('An administrator approves new accounts.'), style: TextStyle(color: p.subtext)),
                          const SizedBox(height: 24),
                          Glass(
                            radius: 30,
                            padding: const EdgeInsets.all(20),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                              TextField(
                                  controller: _user,
                                  autocorrect: false,
                                  textInputAction: TextInputAction.next,
                                  decoration: InputDecoration(
                                      hintText: t('Username'), prefixIcon: const Icon(Icons.person_outline_rounded))),
                              const SizedBox(height: 12),
                              TextField(
                                  controller: _email,
                                  keyboardType: TextInputType.emailAddress,
                                  textInputAction: TextInputAction.next,
                                  decoration: InputDecoration(
                                      hintText: t('Email'), prefixIcon: const Icon(Icons.mail_outline_rounded))),
                              const SizedBox(height: 12),
                              TextField(
                                controller: _pass,
                                obscureText: _hide,
                                textInputAction: TextInputAction.next,
                                decoration: InputDecoration(
                                  hintText: t('Password'),
                                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                                  suffixIcon: IconButton(
                                    icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                                    onPressed: () => setState(() => _hide = !_hide),
                                  ),
                                ),
                              ),
                              if (_pass.text.isNotEmpty) ...[
                                const SizedBox(height: 10),
                                Row(children: [
                                  for (var i = 0; i < 4; i++)
                                    Expanded(
                                      child: AnimatedContainer(
                                        duration: const Duration(milliseconds: 250),
                                        height: 5,
                                        margin: const EdgeInsets.symmetric(horizontal: 2),
                                        decoration: BoxDecoration(
                                          gradient: i < _strength ? p.gradient : null,
                                          color: i < _strength ? null : p.border,
                                          borderRadius: BorderRadius.circular(3),
                                        ),
                                      ),
                                    ),
                                ]),
                                const SizedBox(height: 4),
                                Text(labels[_strength], style: TextStyle(color: p.subtext, fontSize: 12)),
                              ],
                              const SizedBox(height: 12),
                              TextField(
                                  controller: _pass2,
                                  obscureText: _hide,
                                  onSubmitted: (_) => _submit(),
                                  decoration: InputDecoration(
                                      hintText: t('Confirm password'), prefixIcon: const Icon(Icons.lock_reset_rounded))),
                              if (_error.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 12),
                                  child: Text(_error, style: TextStyle(color: p.danger)),
                                ),
                              const SizedBox(height: 20),
                              GradientButton(label: t('Send request'), busy: _busy, onPressed: _submit),
                            ]),
                          ),
                        ]),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
