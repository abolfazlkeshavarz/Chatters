import 'package:flutter/material.dart';

import '../../services/chat_socket.dart';
import '../theme.dart';
import '../l10n.dart';

/// A slim pill that slides in while the live connection is down.
class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.status});
  final SocketStatus status;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final show = status != SocketStatus.online;
    final label = switch (status) {
      SocketStatus.connecting => t('Connecting…'),
      SocketStatus.reconnecting => t('Reconnecting…'),
      _ => t('Waiting for network…'),
    };
    return AnimatedSize(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOutCubic,
      child: show
          ? Padding(
              padding: const EdgeInsets.only(top: 6, bottom: 6),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  decoration: BoxDecoration(
                    color: p.warn.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(strokeWidth: 1.8, color: p.warn)),
                    const SizedBox(width: 8),
                    Text(label, style: TextStyle(color: p.warn, fontSize: 12.5, fontWeight: FontWeight.w600)),
                  ]),
                ),
              ),
            )
          : const SizedBox(width: double.infinity),
    );
  }
}
