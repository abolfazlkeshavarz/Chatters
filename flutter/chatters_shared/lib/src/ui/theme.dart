import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../storage.dart';
import 'l10n.dart';

/* ------------------------------------------------------------- accents */

class Accent {
  const Accent(this.name, this.a, this.b);
  final String name;
  final Color a, b;
  LinearGradient get gradient =>
      LinearGradient(colors: [a, b], begin: Alignment.topLeft, end: Alignment.bottomRight);
}

const accents = [
  // The logo's own blue-to-green.
  Accent('Chatters', Color(0xff1d6fe8), Color(0xff43b649)),
  Accent('Aurora', Color(0xff7c3aed), Color(0xffec4899)),
  Accent('Ocean', Color(0xff2563eb), Color(0xff06b6d4)),
  Accent('Sunset', Color(0xfff97316), Color(0xffe11d48)),
  Accent('Mint', Color(0xff059669), Color(0xff3b82f6)),
  Accent('Grape', Color(0xff4f46e5), Color(0xffa855f7)),
];

/* ------------------------------------------------------------ settings */

/// Look-and-feel preferences, kept on the device.
class AppSettings extends ChangeNotifier {
  AppSettings._();
  static final AppSettings instance = AppSettings._();

  ThemeMode mode = ThemeMode.system;
  int accentIndex = 0;
  bool wallpaper = true;

  /// 'system', 'en', 'fa' or 'it'.
  String language = 'system';

  /// The language actually in use.
  String get lang {
    if (language != 'system') return language;
    final device = PlatformDispatcher.instance.locale.languageCode;
    return supportedLangs.contains(device) ? device : 'en';
  }

  void _applyLang() {
    currentLang = lang;
    Intl.defaultLocale = lang;
  }

  Accent get accent => accents[accentIndex.clamp(0, accents.length - 1)];

  Future<void> load() async {
    final m = await Storage.readRaw('ui.mode');
    mode = ThemeMode.values.firstWhere((x) => x.name == m, orElse: () => ThemeMode.system);
    accentIndex = int.tryParse(await Storage.readRaw('ui.accent') ?? '') ?? 0;
    wallpaper = (await Storage.readRaw('ui.wallpaper')) != '0';
    language = await Storage.readRaw('ui.lang') ?? 'system';
    _applyLang();
  }

  void setMode(ThemeMode m) {
    mode = m;
    Storage.writeRaw('ui.mode', m.name);
    notifyListeners();
  }

  void setAccent(int i) {
    accentIndex = i;
    Storage.writeRaw('ui.accent', '$i');
    HapticFeedback.selectionClick();
    notifyListeners();
  }

  void setLanguage(String v) {
    language = v;
    Storage.writeRaw('ui.lang', v);
    _applyLang();
    HapticFeedback.selectionClick();
    notifyListeners();
  }

  /// Called when the device language changes while the app runs.
  void deviceLocaleChanged() {
    if (language == 'system') {
      _applyLang();
      notifyListeners();
    }
  }

  void setWallpaper(bool v) {
    wallpaper = v;
    Storage.writeRaw('ui.wallpaper', v ? '1' : '0');
    notifyListeners();
  }
}

/* ------------------------------------------------------------- palette */

class Palette extends ThemeExtension<Palette> {
  const Palette({
    required this.dark,
    required this.accent,
    required this.bg,
    required this.surface,
    required this.surfaceHigh,
    required this.border,
    required this.text,
    required this.subtext,
    required this.danger,
    required this.success,
    required this.secure,
    required this.warn,
    required this.bubbleIn,
    required this.bubbleInText,
  });

  final bool dark;
  final Accent accent;
  final Color bg, surface, surfaceHigh, border, text, subtext;
  final Color danger, success, secure, warn, bubbleIn, bubbleInText;

  Color get primary => accent.a;
  LinearGradient get gradient => accent.gradient;
  LinearGradient get secureGradient => const LinearGradient(
      colors: [Color(0xff059669), Color(0xff10b981)], begin: Alignment.topLeft, end: Alignment.bottomRight);

  factory Palette.of(Brightness b, Accent accent) {
    final d = b == Brightness.dark;
    return Palette(
      dark: d,
      accent: accent,
      bg: d ? const Color(0xff0a0a12) : const Color(0xfff5f5fa),
      surface: d ? const Color(0xff15151f) : Colors.white,
      surfaceHigh: d ? const Color(0xff1e1e2b) : const Color(0xffeeeef5),
      border: d ? const Color(0x1fffffff) : const Color(0x14000000),
      text: d ? const Color(0xfff4f4f8) : const Color(0xff12121a),
      subtext: d ? const Color(0xff9a9ab0) : const Color(0xff6b6b80),
      danger: const Color(0xfff43f5e),
      success: const Color(0xff22c55e),
      secure: const Color(0xff10b981),
      warn: const Color(0xfff59e0b),
      bubbleIn: d ? const Color(0xff1f1f2c) : Colors.white,
      bubbleInText: d ? const Color(0xfff4f4f8) : const Color(0xff12121a),
    );
  }

  @override
  Palette copyWith() => this;

  @override
  Palette lerp(Palette? other, double t) => t < 0.5 ? this : (other ?? this);
}

extension PaletteX on BuildContext {
  Palette get p => Theme.of(this).extension<Palette>()!;
}

const _vazirmatn = 'packages/chatters_shared/Vazirmatn';
const _inter = 'packages/chatters_shared/Inter';

/// On iOS the app uses Apple's own system fonts: SF Pro for Latin text and
/// SF Arabic (the Persian keyboard's font) for Persian — `null` selects them.
/// Apple's license does not allow shipping them on Android, so Android uses
/// the closest open equivalents: Inter (an SF lookalike) and Vazirmatn.
String? get fontFamily {
  if (defaultTargetPlatform == TargetPlatform.iOS) return null;
  return currentLang == 'fa' ? _vazirmatn : _inter;
}

List<String>? get _fallback => defaultTargetPlatform == TargetPlatform.iOS ? null : const [_vazirmatn];

ThemeData buildTheme(Brightness b, Accent accent) {
  final p = Palette.of(b, accent);
  final base = ThemeData(
    useMaterial3: true,
    brightness: b,
    fontFamily: fontFamily,
    fontFamilyFallback: _fallback,
    colorScheme: ColorScheme.fromSeed(
      seedColor: accent.a,
      brightness: b,
      primary: accent.a,
      secondary: accent.b,
      surface: p.surface,
      error: p.danger,
    ),
  );
  return base.copyWith(
    scaffoldBackgroundColor: p.bg,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      foregroundColor: p.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      systemOverlayStyle: p.dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      titleTextStyle: TextStyle(fontFamily: fontFamily, fontFamilyFallback: _fallback, color: p.text, fontSize: 20, fontWeight: FontWeight.w700),
    ),
    dividerColor: p.border,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.surfaceHigh,
      hintStyle: TextStyle(color: p.subtext),
      labelStyle: TextStyle(color: p.subtext),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18), borderSide: BorderSide(color: accent.a, width: 1.6)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: p.subtext.withValues(alpha: 0.4),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: p.dark ? const Color(0xff2a2a3a) : const Color(0xff1c1c28),
      contentTextStyle: TextStyle(fontFamily: fontFamily, fontFamilyFallback: _fallback, color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: p.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    extensions: [p],
  );
}
