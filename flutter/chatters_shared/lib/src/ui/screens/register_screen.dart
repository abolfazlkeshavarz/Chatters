import 'package:flutter/material.dart';

import '../../services/auth.dart';
import '../theme.dart';
import '../widgets/common.dart';

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
  String _error = '';
  String _done = '';

  Future<void> _submit() async {
    if (_user.text.trim().isEmpty || _email.text.trim().isEmpty || _pass.text.isEmpty) {
      setState(() => _error = 'Please fill in every field');
      return;
    }
    if (_pass.text.length < 8) {
      setState(() => _error = 'Password must be at least 8 characters');
      return;
    }
    if (_pass.text != _pass2.text) {
      setState(() => _error = 'Passwords do not match');
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final res = await Auth.instance.register(_user.text.trim(), _email.text.trim(), _pass.text);
      setState(() => _done = (res['message'] as String?) ??
          'Your request was submitted and is waiting for an administrator to approve it.');
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      appBar: AppBar(title: const Text('Request an account')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _done.isNotEmpty
              ? Column(children: [
                  const Text('✅', style: TextStyle(fontSize: 48)),
                  const SizedBox(height: 12),
                  Text(_done, textAlign: TextAlign.center, style: TextStyle(color: p.text)),
                  const SizedBox(height: 20),
                  PrimaryButton(label: 'Back to sign in', onPressed: () => Navigator.pop(context)),
                ])
              : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  TextField(controller: _user, autocorrect: false,
                      decoration: const InputDecoration(labelText: 'Username')),
                  const SizedBox(height: 12),
                  TextField(controller: _email, keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email')),
                  const SizedBox(height: 12),
                  TextField(controller: _pass, obscureText: true,
                      decoration: const InputDecoration(labelText: 'Password (min 8)')),
                  const SizedBox(height: 12),
                  TextField(controller: _pass2, obscureText: true,
                      decoration: const InputDecoration(labelText: 'Confirm password')),
                  if (_error.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(_error, style: TextStyle(color: p.danger)),
                  ],
                  const SizedBox(height: 20),
                  PrimaryButton(label: 'Submit request', busy: _busy, onPressed: _submit),
                ]),
        ),
      ),
    );
  }
}
