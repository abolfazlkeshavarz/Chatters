import 'package:flutter/material.dart';

import '../../services/chat_socket.dart';
import '../theme.dart';

class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.status});
  final SocketStatus status;

  @override
  Widget build(BuildContext context) {
    if (status == SocketStatus.online) return const SizedBox.shrink();
    final label = switch (status) {
      SocketStatus.connecting => 'Connecting…',
      SocketStatus.reconnecting => 'Reconnecting…',
      _ => 'Offline',
    };
    return Container(
      width: double.infinity,
      color: context.p.warnBg,
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Text(label, textAlign: TextAlign.center, style: TextStyle(color: context.p.warnText, fontSize: 12)),
    );
  }
}
