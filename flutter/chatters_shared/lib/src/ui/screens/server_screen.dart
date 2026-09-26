import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../config.dart';
import '../../services/auth.dart';
import '../../storage.dart';
import '../l10n.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';

/// Points the app at a different Chatters server.
class ServerScreen extends StatefulWidget {
  const ServerScreen({super.key});
  @override
  State<ServerScreen> createState() => _ServerScreenState();
}

class _ServerScreenState extends State<ServerScreen> {
  late final _ctl = TextEditingController(text: apiBase);
  bool _testing = false;
  bool? _ok;
  String _message = '';

  Future<bool> _test() async {
    setState(() {
      _testing = true;
      _ok = null;
      _message = '';
    });
    final url = normalizeServer(_ctl.text);
    try {
      final res = await http.get(Uri.parse('$url/healthz')).timeout(const Duration(seconds: 8));
      _ok = res.statusCode >= 200 && res.statusCode < 300;
      _message = _ok! ? t('Server is reachable') : t('The server answered with an error ({code})', {'code': res.statusCode});
    } catch (_) {
      _ok = false;
      _message = t('Could not reach this server');
    }
    if (mounted) setState(() => _testing = false);
    return _ok!;
  }

  Future<void> _save({bool reset = false}) async {
    final url = reset ? '' : normalizeServer(_ctl.text);
    if (!reset && url == apiBase) {
      Navigator.pop(context);
      return;
    }
    if (!reset && !await _test()) {
      if (!mounted) return;
      final go = await confirm(context, t('Use it anyway?'), _message, ok: t('Save'));
      if (!go) return;
    }
    if (!mounted) return;
    if (Auth.instance.signedIn &&
        !await confirm(context, t('Change server?'), t('You will be signed out of this account.'),
            ok: t('Change server'), icon: Icons.dns_rounded)) {
      return;
    }
    // Sign out against the old server first, then switch.
    if (Auth.instance.signedIn) await Auth.instance.logout();
    await Storage.writeRaw(Storage.serverKey, reset ? null : url);
    setServerOverride(reset ? null : url);
    if (mounted) {
      toast(context, t('Server changed'));
      Navigator.of(context).popUntil((r) => r.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      appBar: AppBar(title: Text(t('Server'))),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Center(child: GradientIcon(Icons.dns_rounded, size: 76, radius: 26)),
        const SizedBox(height: 16),
        Text(t('Server address'),
            textAlign: TextAlign.center, style: TextStyle(color: p.text, fontSize: 22, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text(t('Use this to connect to your own or another Chatters server.'),
            textAlign: TextAlign.center, style: TextStyle(color: p.subtext, height: 1.4)),
        const SizedBox(height: 24),
        TextField(
          controller: _ctl,
          keyboardType: TextInputType.url,
          autocorrect: false,
          textDirection: TextDirection.ltr,
          onChanged: (_) => setState(() => _ok = null),
          decoration: const InputDecoration(prefixIcon: Icon(Icons.link_rounded), hintText: 'https://chat.example.com'),
        ),
        const SizedBox(height: 12),
        AnimatedSize(
          duration: const Duration(milliseconds: 200),
          child: _ok == null
              ? const SizedBox(width: double.infinity)
              : Row(children: [
                  Icon(_ok! ? Icons.check_circle_rounded : Icons.error_rounded, color: _ok! ? p.success : p.danger, size: 18),
                  const SizedBox(width: 6),
                  Expanded(child: Text(_message, style: TextStyle(color: _ok! ? p.success : p.danger))),
                ]),
        ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18))),
          onPressed: _testing ? null : _test,
          icon: _testing
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.wifi_tethering_rounded),
          label: Text(t('Test connection')),
        ),
        const SizedBox(height: 12),
        GradientButton(label: t('Save'), icon: Icons.check_rounded, onPressed: _testing ? null : () => _save()),
        if (hasServerOverride) ...[
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => _save(reset: true),
            child: Text(t('Use the default server'), style: TextStyle(color: p.subtext)),
          ),
        ],
        const SizedBox(height: 16),
        Text(t('Default: {url}', {'url': normalizeServer(defaultApiBase)}),
            textAlign: TextAlign.center, style: TextStyle(color: p.subtext, fontSize: 12)),
      ]),
    );
  }
}
