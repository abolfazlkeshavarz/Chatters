import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../services/auth.dart';
import '../services/call_service.dart';
import '../services/chat_socket.dart';
import '../services/notifications.dart';
import '../storage.dart';
import 'navigation.dart';
import 'screens/call_screen.dart';
import 'screens/chat_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'l10n.dart';
import 'theme.dart';

final navigatorKey = GlobalKey<NavigatorState>();

/// Entry point used by both the Android and the iOS app.
Future<void> runChattersApp() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Storage.hydrate();
  await initializeDateFormatting();
  await AppSettings.instance.load();
  Auth.instance.init();
  Notifications.instance.onOpenChat = (chatId) {
    navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => ChatScreen(chatId: chatId)));
  };
  CallService.instance.onIncomingCall = () {
    final ctx = navigatorKey.currentContext;
    if (ctx != null) showCallScreen(ctx);
  };
  runApp(const ChattersApp());
}

class ChattersApp extends StatefulWidget {
  const ChattersApp({super.key});
  @override
  State<ChattersApp> createState() => _ChattersAppState();
}

class _ChattersAppState extends State<ChattersApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Auth.instance.addListener(_onAuth);
    AppSettings.instance.addListener(_rebuild);
    if (Auth.instance.signedIn) Notifications.instance.init();
  }

  String _lang = currentLang;

  void _rebuild() {
    setState(() {});
    if (_lang != currentLang) {
      _lang = currentLang;
      // Const widgets hold translated text too: refresh the whole tree.
      final ctx = navigatorKey.currentContext;
      if (ctx != null) WidgetsBinding.instance.addPostFrameCallback((_) => rebuildAll(ctx));
    }
  }

  @override
  void didChangeLocales(List<Locale>? locales) => AppSettings.instance.deviceLocaleChanged();

  void _onAuth() {
    if (Auth.instance.signedIn) Notifications.instance.init();
    navigatorKey.currentState?.popUntil((r) => r.isFirst);
    setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    Notifications.instance.appInForeground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) ChatSocket.instance.ensureAlive();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    Auth.instance.removeListener(_onAuth);
    AppSettings.instance.removeListener(_rebuild);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = AppSettings.instance;
    return MaterialApp(
      title: 'Chatters',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      themeMode: s.mode,
      locale: Locale(s.lang),
      supportedLocales: const [Locale('en'), Locale('fa'), Locale('it')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: buildTheme(Brightness.light, s.accent),
      darkTheme: buildTheme(Brightness.dark, s.accent),
      themeAnimationDuration: const Duration(milliseconds: 350),
      builder: (context, child) => Stack(children: [
        child!,
        // Shown over every screen while a call runs with its screen minimized.
        ListenableBuilder(
          listenable: Listenable.merge([CallService.instance, CallScreen.visible]),
          builder: (context, _) {
            final c = CallService.instance;
            final show = !CallScreen.visible.value && (c.busy || c.phase == CallPhase.ended);
            return AnimatedSlide(
              offset: show ? Offset.zero : const Offset(0, -1.5),
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOutCubic,
              child: show
                  ? ReturnToCallBar(onTap: () {
                      final ctx = navigatorKey.currentContext;
                      if (ctx != null) showCallScreen(ctx);
                    })
                  : const SizedBox.shrink(),
            );
          },
        ),
      ]),
      home: AnimatedSwitcher(
        duration: const Duration(milliseconds: 450),
        switchInCurve: Curves.easeOutCubic,
        child: Auth.instance.signedIn
            ? const HomeScreen(key: ValueKey('home'))
            : const LoginScreen(key: ValueKey('login')),
      ),
    );
  }
}
