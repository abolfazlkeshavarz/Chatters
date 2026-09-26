import 'package:flutter/material.dart';

import '../theme.dart';

/// A soft accent-tinted gradient with a sparse dot pattern.
class ChatWallpaper extends StatelessWidget {
  const ChatWallpaper({super.key, this.secure = false});
  final bool secure;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final a = secure ? const Color(0xff059669) : p.accent.a;
    final b = secure ? const Color(0xff10b981) : p.accent.b;
    return Container(
      decoration: BoxDecoration(
        color: p.bg,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color.alphaBlend(a.withValues(alpha: p.dark ? 0.16 : 0.08), p.bg),
            p.bg,
            Color.alphaBlend(b.withValues(alpha: p.dark ? 0.14 : 0.08), p.bg),
          ],
        ),
      ),
      child: CustomPaint(painter: _Dots(p.text.withValues(alpha: p.dark ? 0.05 : 0.045)), size: Size.infinite),
    );
  }
}

class _Dots extends CustomPainter {
  _Dots(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    const step = 26.0;
    for (var y = 0.0, row = 0; y < size.height + step; y += step, row++) {
      for (var x = (row.isOdd ? step / 2 : 0.0); x < size.width + step; x += step) {
        canvas.drawCircle(Offset(x, y), 1.4, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _Dots old) => old.color != color;
}
