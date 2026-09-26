import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../api/endpoints.dart';
import '../l10n.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';

class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key});
  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  List<Map<String, dynamic>> _sessions = [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await getSessions();
      if (mounted) {
        setState(() {
          _sessions = s;
          _error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = errText(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _revoke(Map<String, dynamic> s) async {
    if (!await confirm(context, t('Sign out this device?'), '${s['device']}',
        ok: t('Sign out'), destructive: true, icon: Icons.logout_rounded)) {
      return;
    }
    setState(() => _sessions.removeWhere((x) => x['id'] == s['id']));
    try {
      await revokeSession(s['id'] as String);
      if (mounted) toast(context, t('Device signed out'));
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
      _load();
    }
  }

  Future<void> _revokeOthers() async {
    if (!await confirm(context, t('Sign out all other devices?'),
        t('Every device except this one will need to sign in again.'),
        ok: t('Sign out all'), destructive: true, icon: Icons.devices_other_rounded)) {
      return;
    }
    try {
      final n = await revokeOtherSessions();
      if (mounted) toast(context, t('{n} devices signed out', {'n': n}));
      _load();
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    }
  }

  IconData _icon(Map<String, dynamic> s) => switch (s['platform']) {
        'android' => Icons.android_rounded,
        'ios' => Icons.phone_iphone_rounded,
        _ => Icons.language_rounded,
      };

  String _when(String? ts) {
    final d = ts == null ? null : DateTime.tryParse(ts)?.toLocal();
    if (d == null) return '';
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 2) return t('Active now');
    if (diff.inHours < 1) return t('{n} min ago', {'n': diff.inMinutes});
    if (diff.inDays < 1) return t('{n} h ago', {'n': diff.inHours});
    return persianDigits(DateFormat.yMMMd().format(d));
  }

  Widget _tile(Map<String, dynamic> s, {required bool current}) {
    final p = context.p;
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(children: [
        GradientIcon(_icon(s), size: 46, gradient: current ? p.secureGradient : null),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${s['device']}'.isEmpty ? t('Unknown device') : '${s['device']}',
                style: TextStyle(color: p.text, fontWeight: FontWeight.w700, fontSize: 15.5)),
            const SizedBox(height: 2),
            Text(
              [
                if ('${s['ip']}'.isNotEmpty) '${s['ip']}',
                current ? t('This device') : _when(s['last_seen_at'] as String?),
              ].join(' · '),
              style: TextStyle(color: current ? p.secure : p.subtext, fontSize: 12.5, fontWeight: current ? FontWeight.w700 : FontWeight.w400),
            ),
            Text(t('Signed in {date}', {'date': persianDigits(DateFormat.yMMMd().format(DateTime.parse(s['created_at'] as String).toLocal()))}),
                style: TextStyle(color: p.subtext, fontSize: 12)),
          ]),
        ),
        if (!current)
          IconButton(
            tooltip: t('Sign out'),
            icon: Icon(Icons.logout_rounded, color: p.danger),
            onPressed: () => _revoke(s),
          ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final current = _sessions.where((s) => s['current'] == true).toList();
    final others = _sessions.where((s) => s['current'] != true).toList();
    return Scaffold(
      appBar: AppBar(title: Text(t('Active sessions'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                if (_error.isNotEmpty)
                  Padding(padding: const EdgeInsets.all(20), child: Text(_error, style: TextStyle(color: p.danger))),
                if (current.isNotEmpty)
                  SectionCard(title: t('This device'), children: [for (final s in current) _tile(s, current: true)]),
                if (others.isNotEmpty) ...[
                  SectionCard(title: t('Other devices'), children: [for (final s in others) _tile(s, current: false)]),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                    child: GradientButton(
                      label: t('Sign out all other devices'),
                      icon: Icons.devices_other_rounded,
                      gradient: LinearGradient(colors: [const Color(0xfffb7185), p.danger]),
                      onPressed: _revokeOthers,
                    ),
                  ),
                ] else if (_error.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(children: [
                      Icon(Icons.verified_user_rounded, color: p.secure, size: 40),
                      const SizedBox(height: 10),
                      Text(t('No other devices are signed in.'),
                          textAlign: TextAlign.center, style: TextStyle(color: p.subtext)),
                    ]),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 20, 24, 0),
                  child: Text(
                    t("Don't recognise a device? Sign it out and change your password."),
                    textAlign: TextAlign.center,
                    style: TextStyle(color: p.subtext, fontSize: 12.5, height: 1.5),
                  ),
                ),
              ]),
            ),
    );
  }
}
