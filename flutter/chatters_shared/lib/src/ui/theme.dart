import 'package:flutter/material.dart';

/// The web app's colour tokens, light + dark.
class Palette extends ThemeExtension<Palette> {
  const Palette({
    required this.bg,
    required this.card,
    required this.border,
    required this.text,
    required this.subtext,
    required this.primary,
    required this.danger,
    required this.success,
    required this.unreadBg,
    required this.bubbleIn,
    required this.bubbleInText,
    required this.secure,
    required this.secureBg,
    required this.bubbleSent,
    required this.bubbleSentText,
    required this.bubbleSentBorder,
    required this.warnBg,
    required this.warnText,
  });

  final Color bg, card, border, text, subtext, primary, danger, success, unreadBg;
  final Color bubbleIn, bubbleInText, secure, secureBg, bubbleSent, bubbleSentText;
  final Color bubbleSentBorder, warnBg, warnText;

  static const light = Palette(
    bg: Color(0xfff4f5f9),
    card: Color(0xffffffff),
    border: Color(0xffe3e5ec),
    text: Color(0xff17181d),
    subtext: Color(0xff6b6f7d),
    primary: Color(0xff5457e5),
    danger: Color(0xffef4444),
    success: Color(0xff22b573),
    unreadBg: Color(0xffeeeefd),
    bubbleIn: Color(0xffeceef3),
    bubbleInText: Color(0xff17181d),
    secure: Color(0xff16a367),
    secureBg: Color(0xffe6f7ee),
    bubbleSent: Color(0xffffffff),
    bubbleSentText: Color(0xff17181d),
    bubbleSentBorder: Color(0xffd8dae2),
    warnBg: Color(0xfffff4d6),
    warnText: Color(0xff5c4400),
  );

  static const dark = Palette(
    bg: Color(0xff0b0c10),
    card: Color(0xff17181e),
    border: Color(0xff2a2c36),
    text: Color(0xfff2f2f7),
    subtext: Color(0xff9498a8),
    primary: Color(0xff7376f0),
    danger: Color(0xffef4444),
    success: Color(0xff22b573),
    unreadBg: Color(0xff1e2040),
    bubbleIn: Color(0xff24262f),
    bubbleInText: Color(0xfff2f2f7),
    secure: Color(0xff16a367),
    secureBg: Color(0xff10281c),
    bubbleSent: Color(0xffe9e9ed),
    bubbleSentText: Color(0xff1c1c1e),
    bubbleSentBorder: Color(0xffe9e9ed),
    warnBg: Color(0xff3a2f10),
    warnText: Color(0xfff0d99a),
  );

  @override
  Palette copyWith() => this;

  @override
  Palette lerp(Palette? other, double t) => t < 0.5 ? this : (other ?? this);
}

extension PaletteX on BuildContext {
  Palette get p => Theme.of(this).extension<Palette>()!;
}

ThemeData buildTheme(Brightness b) {
  final p = b == Brightness.dark ? Palette.dark : Palette.light;
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: ColorScheme.fromSeed(seedColor: p.primary, brightness: b, primary: p.primary),
    scaffoldBackgroundColor: p.bg,
    appBarTheme: AppBarTheme(backgroundColor: p.card, foregroundColor: p.text, elevation: 0),
    cardColor: p.card,
    dividerColor: p.border,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.card,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    ),
    extensions: [p],
  );
}
