import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../storage.dart';
import 'chat_socket.dart';
import '../ui/l10n.dart';

/// Local notifications for messages that arrive over the live socket while
/// the chat is not on screen (or the app is in the background but still
/// connected). Remote push would need Firebase / APNs; see the README.
class Notifications {
  Notifications._();
  static final Notifications instance = Notifications._();

  final _plugin = FlutterLocalNotificationsPlugin();
  final Set<String> mutedChats = {};
  String? activeChatId;
  bool appInForeground = true;
  void Function(String chatId)? onOpenChat;
  StreamSubscription? _sub;
  bool _ready = false;

  Future<void> init() async {
    if (_ready) return;
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(),
    );
    try {
      await _plugin.initialize(settings, onDidReceiveNotificationResponse: (r) {
        final id = r.payload;
        if (id != null && id.isNotEmpty) onOpenChat?.call(id);
      });
      await _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      await _plugin
          .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
      _ready = true;
    } catch (e) {
      debugPrint('notifications unavailable: $e');
    }
    _sub ??= ChatSocket.instance.messages.listen(_onMessage);
  }

  void _onMessage(Map<String, dynamic> msg) {
    if (!_ready) return;
    final type = msg['type'];
    if (type != 'message' && type != 'media') return;
    if (msg['is_system'] == true) return;
    final from = msg['from'] as String?;
    final chatId = msg['chat_id'] as String?;
    if (from == null || chatId == null || from == Storage.username) return;
    if (mutedChats.contains(chatId)) return;
    if (appInForeground && activeChatId == chatId) return;

    final body = msg['is_encrypted'] == true
        ? '🔒 Encrypted message'
        : type == 'media'
            ? '📎 ${msg['filename'] ?? t('Attachment')}'
            : (msg['content'] as String? ?? '');
    _plugin.show(
      chatId.hashCode & 0x7fffffff,
      from,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails('messages', t('Messages'),
            importance: Importance.high, priority: Priority.high),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: chatId,
    );
  }
}
