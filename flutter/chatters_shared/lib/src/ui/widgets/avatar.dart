import 'package:flutter/material.dart';

import '../../api/client.dart';
import '../../api/endpoints.dart';

const _colors = [
  Color(0xff5457e5), Color(0xffe5546b), Color(0xff22b573), Color(0xfff59e0b),
  Color(0xff0ea5e9), Color(0xff8b5cf6), Color(0xffec4899), Color(0xff14b8a6),
];

/// A user's photo, falling back to a coloured initial when they have none or
/// it is not visible to us (the endpoint 404s).
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, required this.userId, this.size = 40, this.bust});
  final String userId;
  final double size;
  final Object? bust;

  @override
  Widget build(BuildContext context) {
    final color = _colors[userId.codeUnits.fold<int>(0, (a, c) => a + c) % _colors.length];
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      child: Text(
        userId.isEmpty ? '?' : userId.characters.first.toUpperCase(),
        style: TextStyle(color: Colors.white, fontSize: size * 0.42, fontWeight: FontWeight.w600),
      ),
    );
    if (userId.isEmpty) return fallback;
    return ClipOval(
      child: Image.network(
        avatarUrl(userId, bust),
        headers: Api.authHeader(),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallback,
        loadingBuilder: (_, child, progress) => progress == null ? child : fallback,
      ),
    );
  }
}
