import 'package:flutter/material.dart';

import '../../api/client.dart';
import '../../api/endpoints.dart';
import '../theme.dart';

const _pairs = [
  [Color(0xff7c3aed), Color(0xffec4899)],
  [Color(0xff2563eb), Color(0xff06b6d4)],
  [Color(0xfff97316), Color(0xffe11d48)],
  [Color(0xff059669), Color(0xff84cc16)],
  [Color(0xff4f46e5), Color(0xffa855f7)],
  [Color(0xffdb2777), Color(0xfff59e0b)],
  [Color(0xff0ea5e9), Color(0xff6366f1)],
  [Color(0xff14b8a6), Color(0xff22c55e)],
];

LinearGradient gradientFor(String seed) {
  final pair = _pairs[seed.codeUnits.fold<int>(0, (a, c) => a * 31 + c) % _pairs.length];
  return LinearGradient(colors: pair, begin: Alignment.topLeft, end: Alignment.bottomRight);
}

/// A user's photo, falling back to a gradient initial when they have none or
/// it is not visible to us (the endpoint 404s). `ring` draws the accent
/// gradient around it (used for unread chats).
class UserAvatar extends StatelessWidget {
  const UserAvatar({
    super.key,
    required this.userId,
    this.size = 44,
    this.bust,
    this.ring = false,
    this.group = false,
    this.secret = false,
  });
  final String userId;
  final double size;
  final Object? bust;
  final bool ring;
  final bool group;
  final bool secret;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final initial = userId.isEmpty ? '?' : userId.characters.first.toUpperCase();
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(gradient: gradientFor(userId), shape: BoxShape.circle),
      child: group
          ? Icon(Icons.groups_rounded, color: Colors.white, size: size * 0.5)
          : Text(initial,
              style: TextStyle(color: Colors.white, fontSize: size * 0.4, fontWeight: FontWeight.w700)),
    );

    Widget core = group || userId.isEmpty
        ? fallback
        : ClipOval(
            child: Image.network(
              avatarUrl(userId, bust),
              headers: Api.authHeader(),
              width: size,
              height: size,
              fit: BoxFit.cover,
              gaplessPlayback: true,
              errorBuilder: (_, __, ___) => fallback,
              loadingBuilder: (_, child, progress) => progress == null ? child : fallback,
            ),
          );

    if (secret) {
      core = Stack(clipBehavior: Clip.none, children: [
        core,
        Positioned(
          right: -2,
          bottom: -2,
          child: Container(
            width: size * 0.4,
            height: size * 0.4,
            decoration: BoxDecoration(
              gradient: p.secureGradient,
              shape: BoxShape.circle,
              border: Border.all(color: p.bg, width: 2),
            ),
            child: Icon(Icons.lock_rounded, color: Colors.white, size: size * 0.2),
          ),
        ),
      ]);
    }

    if (!ring) return core;
    return Container(
      padding: const EdgeInsets.all(2.5),
      decoration: BoxDecoration(gradient: p.gradient, shape: BoxShape.circle),
      child: Container(
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(color: p.bg, shape: BoxShape.circle),
        child: core,
      ),
    );
  }
}
