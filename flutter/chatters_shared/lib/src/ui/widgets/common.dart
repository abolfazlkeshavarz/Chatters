import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';
import 'design.dart';
import '../l10n.dart';

Future<bool> confirm(BuildContext context, String title, String body,
    {String? ok, bool destructive = false, IconData? icon}) async {
  final p = context.p;
  final r = await showModalBottomSheet<bool>(
    context: context,
    builder: (c) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          GradientIcon(icon ?? (destructive ? Icons.delete_outline_rounded : Icons.help_outline_rounded),
              size: 60,
              gradient: destructive ? LinearGradient(colors: [p.danger, const Color(0xfffb7185)]) : null),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center,
              style: TextStyle(color: p.text, fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(body, textAlign: TextAlign.center, style: TextStyle(color: p.subtext, height: 1.5)),
          const SizedBox(height: 24),
          GradientButton(
            label: ok ?? t('OK'),
            onPressed: () => Navigator.pop(c, true),
            gradient: destructive ? LinearGradient(colors: [p.danger, const Color(0xfffb7185)]) : null,
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: Text(t('Cancel'), style: TextStyle(color: p.subtext, fontWeight: FontWeight.w600)),
          ),
        ]),
      ),
    ),
  );
  return r == true;
}

/// A bottom sheet with a single text field and a gradient button.
Future<String?> promptText(BuildContext context, String title,
    {String hint = '', bool obscure = false, String? ok, IconData? icon}) {
  final ctl = TextEditingController();
  final p = context.p;
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (c) => Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.of(c).viewInsets.bottom + 24),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(title, style: TextStyle(color: p.text, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        TextField(
          controller: ctl,
          autofocus: true,
          obscureText: obscure,
          onSubmitted: (v) => Navigator.pop(c, v),
          decoration: InputDecoration(hintText: hint, prefixIcon: icon != null ? Icon(icon) : null),
        ),
        const SizedBox(height: 16),
        GradientButton(label: ok ?? t('Save'), onPressed: () => Navigator.pop(c, ctl.text)),
      ]),
    ),
  );
}

void toast(BuildContext context, String msg, {bool error = false}) {
  if (error) HapticFeedback.heavyImpact();
  final p = context.p;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(children: [
        Icon(error ? Icons.error_outline_rounded : Icons.check_circle_rounded,
            color: error ? p.danger : p.success, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(msg)),
      ]),
    ));
}

/// Readable text for an exception.
String errText(Object e) => e.toString().replaceFirst('Exception: ', '');
