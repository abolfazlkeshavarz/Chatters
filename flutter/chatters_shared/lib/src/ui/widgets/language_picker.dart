import 'package:flutter/material.dart';

import '../l10n.dart';
import '../theme.dart';
import 'design.dart';

/// Each language names itself, so it is recognisable whatever is active.
const languageOptions = [
  ('system', '🌐', 'Auto'),
  ('en', '🇬🇧', 'English'),
  ('fa', '🇮🇷', 'فارسی'),
  ('it', '🇮🇹', 'Italiano'),
];

String languageName(String code) =>
    languageOptions.where((o) => o.$1 == code).map((o) => code == 'system' ? t(o.$3) : o.$3).first;

/// A 2×2 grid of language cards.
class LanguageGrid extends StatelessWidget {
  const LanguageGrid({super.key, this.onPicked});
  final VoidCallback? onPicked;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final s = AppSettings.instance;
    return ListenableBuilder(
      listenable: s,
      builder: (context, _) => GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 2.6,
        physics: const NeverScrollableScrollPhysics(),
        children: [
          for (final (code, flag, _) in languageOptions)
            Pressable(
              onTap: () {
                s.setLanguage(code);
                onPicked?.call();
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  gradient: s.language == code ? p.gradient : null,
                  color: s.language == code ? null : p.surfaceHigh,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(children: [
                  Text(flag, style: const TextStyle(fontSize: 22)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      languageName(code),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: s.language == code ? Colors.white : p.text,
                        fontWeight: FontWeight.w700,
                        // Show each name in its own script's font.
                        fontFamily: code == 'fa' ? null : fontFamily,
                      ),
                    ),
                  ),
                  if (s.language == code) const Icon(Icons.check_circle_rounded, color: Colors.white, size: 20),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}

void showLanguageSheet(BuildContext context) {
  final p = context.p;
  showModalBottomSheet(
    context: context,
    builder: (c) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(t('Language'), style: TextStyle(color: p.text, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          LanguageGrid(onPicked: () => Navigator.pop(c)),
        ]),
      ),
    ),
  );
}
