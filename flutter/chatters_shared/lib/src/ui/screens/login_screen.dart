import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/auth.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';
import '../widgets/language_picker.dart';
import 'register_screen.dart';
import '../l10n.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  bool _busy = false;
  bool _hide = true;
  String _error = '';

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_user.text.trim().isEmpty || _pass.text.isEmpty) {
      setState(() => _error = t('Enter your username and password'));
      HapticFeedback.heavyImpact();
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await Auth.instance.login(_user.text.trim(), _pass.text);
      HapticFeedback.lightImpact();
    } catch (e) {
      HapticFeedback.heavyImpact();
      if (mounted) setState(() => _error = errText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: AuroraBackground(
        child: SafeArea(
          child: Stack(children: [
            PositionedDirectional(
              top: 8,
              end: 12,
              child: Glass(
                radius: 20,
                child: InkWell(
                  onTap: () => showLanguageSheet(context),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.language_rounded, size: 18, color: p.text),
                      const SizedBox(width: 6),
                      Text(languageName(AppSettings.instance.language),
                          style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                    ]),
                  ),
                ),
              ),
            ),
            Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    FadeSlideIn(child: Center(child: _Logo())),
                    const SizedBox(height: 22),
                    FadeSlideIn(
                      index: 1,
                      child: Column(children: [
                        Text(t('Welcome back'),
                            style: TextStyle(
                                color: p.text, fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                        const SizedBox(height: 6),
                        Text(t('Sign in to pick up your conversations'), style: TextStyle(color: p.subtext, fontSize: 15)),
                      ]),
                    ),
                    const SizedBox(height: 32),
                    FadeSlideIn(
                      index: 2,
                      child: Glass(
                        radius: 30,
                        padding: const EdgeInsets.all(20),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          TextField(
                            controller: _user,
                            autocorrect: false,
                            textInputAction: TextInputAction.next,
                            decoration: InputDecoration(
                                hintText: t('Username or email'), prefixIcon: const Icon(Icons.alternate_email_rounded)),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _pass,
                            obscureText: _hide,
                            onSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              hintText: t('Password'),
                              prefixIcon: const Icon(Icons.lock_outline_rounded),
                              suffixIcon: IconButton(
                                icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                                onPressed: () => setState(() => _hide = !_hide),
                              ),
                            ),
                          ),
                          AnimatedSize(
                            duration: const Duration(milliseconds: 200),
                            child: _error.isEmpty
                                ? const SizedBox(width: double.infinity)
                                : Padding(
                                    padding: const EdgeInsets.only(top: 12),
                                    child: Row(children: [
                                      Icon(Icons.error_outline_rounded, color: p.danger, size: 18),
                                      const SizedBox(width: 6),
                                      Expanded(child: Text(_error, style: TextStyle(color: p.danger))),
                                    ]),
                                  ),
                          ),
                          const SizedBox(height: 20),
                          GradientButton(
                              label: t('Sign in'), icon: Icons.arrow_forward_rounded, busy: _busy, onPressed: _submit),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 20),
                    FadeSlideIn(
                      index: 3,
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text(t('New here?'), style: TextStyle(color: p.subtext)),
                        TextButton(
                          onPressed: () =>
                              Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
                          child: GradientText(t('Request an account'),
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                        ),
                      ]),
                    ),
                  ]),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _Logo extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Container(
      width: 88,
      height: 88,
      decoration: BoxDecoration(
        gradient: p.gradient,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [BoxShadow(color: p.primary.withValues(alpha: 0.45), blurRadius: 40, offset: const Offset(0, 16))],
      ),
      child: const Icon(Icons.forum_rounded, color: Colors.white, size: 44),
    );
  }
}
