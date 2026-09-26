import 'package:flutter/material.dart';

import '../api/endpoints.dart';
import '../services/call_service.dart';
import '../services/stores.dart';
import 'screens/call_screen.dart';
import 'screens/chat_screen.dart';
import 'widgets/common.dart';
import 'l10n.dart';

String chatTitle(Map<String, dynamic> chat, String? me) {
  final others = ((chat['members'] as List?) ?? []).cast<String>().where((u) => u != me).toList();
  if (chat['is_group'] == true) {
    final name = chat['name'] as String?;
    return (name != null && name.isNotEmpty) ? name : (others.isEmpty ? t('Group') : others.join(', '));
  }
  return others.isNotEmpty ? others.first : t('Saved messages');
}

Future<void> openChat(BuildContext context, Map<String, dynamic> chat) async {
  await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(chat: chat)));
  ChatsStore.instance.load();
}

/// Opens (creating if needed) a 1:1 or a secret chat with [userId].
Future<void> openDirectChat(BuildContext context, String userId, {bool secret = false}) async {
  try {
    final res = secret ? await createSecretChat(userId) : await createChat([userId], false, '');
    final id = res['chat_id'] as String?;
    final list = await ChatsStore.instance.load();
    final chat = list.where((c) => c['id'] == id).firstOrNull;
    if (!context.mounted) return;
    if (chat != null) {
      await openChat(context, chat);
    } else if (id != null) {
      await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(chatId: id)));
    }
  } catch (e) {
    if (context.mounted) toast(context, errText(e), error: true);
  }
}

void showCallScreen(BuildContext context) {
  if (CallScreen.visible.value) return;
  Navigator.of(context, rootNavigator: true).push(
    PageRouteBuilder(
      pageBuilder: (_, __, ___) => const CallScreen(),
      transitionsBuilder: (_, a, __, child) => SlideTransition(
        position: Tween(begin: const Offset(0, 1), end: Offset.zero)
            .animate(CurvedAnimation(parent: a, curve: Curves.easeOutCubic)),
        child: child,
      ),
    ),
  );
}

/// Starts a voice call in a 1:1 chat (or returns to the one in progress).
Future<void> startCall(BuildContext context, String chatId, String peer) async {
  final call = CallService.instance;
  if (!call.busy) call.start(chatId: chatId, peer: peer);
  showCallScreen(context);
}
