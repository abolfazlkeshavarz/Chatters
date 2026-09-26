import 'package:flutter/material.dart';

import '../services/auth.dart';
import '../services/chat_socket.dart';
import '../services/notifications.dart';
import '../storage.dart';
import 'screens/chat_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

final navigatorKey = GlobalKey<NavigatorState>();

/// Entry point used by both the Android and the iOS app.
Future<void> runChattersApp() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Storage.hydrate();
  Auth.instance.init();
  Notifications.instance.onOpenChat = (chatId) {
    navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => ChatScreen(chatId: chatId)));
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
    if (Auth.instance.signedIn) Notifications.instance.init();
  }

  void _onAuth() {
    if (Auth.instance.signedIn) Notifications.instance.init();
    // Leave any pushed chat routes behind on sign-in / sign-out.
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Chatters',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      home: Auth.instance.signedIn ? const HomeScreen() : const LoginScreen(),
    );
  }
}
