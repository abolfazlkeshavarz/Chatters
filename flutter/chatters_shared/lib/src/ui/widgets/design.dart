import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

/// Slowly drifting, blurred colour blobs in the accent colours: the backdrop
/// for sign-in and the headers.
class AuroraBackground extends StatefulWidget {
  const AuroraBackground({super.key, this.child, this.intensity = 1});
  final Widget? child;
  final double intensity;

  @override
  State<AuroraBackground> createState() => _AuroraBackgroundState();
}

class _AuroraBackgroundState extends State<AuroraBackground> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(seconds: 18))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final alpha = (p.dark ? 0.55 : 0.35) * widget.intensity;
    return Stack(children: [
      Positioned.fill(child: ColoredBox(color: p.bg)),
      Positioned.fill(
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            final t = _c.value * 2 * math.pi;
            return LayoutBuilder(builder: (context, box) {
              final w = box.maxWidth, h = box.maxHeight;
              Widget blob(Color c, double x, double y, double size) => Positioned(
                    left: x - size / 2,
                    top: y - size / 2,
                    child: Container(
                      width: size,
                      height: size,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(colors: [c.withValues(alpha: alpha), c.withValues(alpha: 0)]),
                      ),
                    ),
                  );
              return Stack(children: [
                blob(p.accent.a, w * (0.2 + 0.15 * math.sin(t)), h * (0.15 + 0.08 * math.cos(t)), w * 1.1),
                blob(p.accent.b, w * (0.85 + 0.1 * math.cos(t * 1.3)), h * (0.35 + 0.1 * math.sin(t)), w * 1.0),
                blob(Color.lerp(p.accent.a, p.accent.b, 0.5)!, w * (0.4 + 0.2 * math.sin(t * 0.7)),
                    h * (0.85 + 0.06 * math.cos(t * 1.1)), w * 1.2),
              ]);
            });
          },
        ),
      ),
      if (widget.child != null) Positioned.fill(child: widget.child!),
    ]);
  }
}

/// Frosted glass surface.
class Glass extends StatelessWidget {
  const Glass({super.key, required this.child, this.radius = 24, this.padding, this.blur = 24, this.opacity});
  final Widget child;
  final double radius;
  final EdgeInsetsGeometry? padding;
  final double blur;
  final double? opacity;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: p.surface.withValues(alpha: opacity ?? (p.dark ? 0.55 : 0.72)),
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: p.dark ? Colors.white.withValues(alpha: 0.08) : Colors.white.withValues(alpha: 0.7)),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// Shrinks a little while pressed; the tactile feel of every tappable card.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onTap, this.onLongPress, this.scale = 0.96, this.haptic = true});
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double scale;
  final bool haptic;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null || widget.onLongPress != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: enabled ? (_) => _set(true) : null,
      onTapUp: enabled ? (_) => _set(false) : null,
      onTapCancel: () => _set(false),
      onTap: widget.onTap == null
          ? null
          : () {
              if (widget.haptic) HapticFeedback.selectionClick();
              widget.onTap!();
            },
      onLongPress: widget.onLongPress == null
          ? null
          : () {
              _set(false);
              HapticFeedback.mediumImpact();
              widget.onLongPress!();
            },
      child: AnimatedScale(
        scale: _down ? widget.scale : 1,
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}

class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.gradient,
    this.height = 56,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;
  final Gradient? gradient;
  final double height;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final g = gradient ?? p.gradient;
    final enabled = onPressed != null && !busy;
    return Pressable(
      onTap: enabled ? onPressed : null,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity: onPressed == null ? 0.5 : 1,
        child: Container(
          height: height,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: g,
            borderRadius: BorderRadius.circular(height / 2.6),
            boxShadow: [
              BoxShadow(
                  color: (g is LinearGradient ? g.colors.first : p.primary).withValues(alpha: 0.35),
                  blurRadius: 24,
                  offset: const Offset(0, 10)),
            ],
          ),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            child: busy
                ? const SizedBox(
                    key: ValueKey('busy'),
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : Row(key: const ValueKey('label'), mainAxisSize: MainAxisSize.min, children: [
                    if (icon != null) ...[Icon(icon, color: Colors.white, size: 20), const SizedBox(width: 8)],
                    Text(label,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
                  ]),
          ),
        ),
      ),
    );
  }
}

class GradientText extends StatelessWidget {
  const GradientText(this.text, {super.key, required this.style, this.gradient});
  final String text;
  final TextStyle style;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    final g = gradient ?? context.p.gradient;
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (r) => g.createShader(Rect.fromLTWH(0, 0, r.width, r.height)),
      child: Text(text, style: style),
    );
  }
}

/// A rounded square with a gradient fill and a white icon.
class GradientIcon extends StatelessWidget {
  const GradientIcon(this.icon, {super.key, this.size = 44, this.gradient, this.radius});
  final IconData icon;
  final double size;
  final Gradient? gradient;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: gradient ?? context.p.gradient,
        borderRadius: BorderRadius.circular(radius ?? size * 0.32),
      ),
      child: Icon(icon, color: Colors.white, size: size * 0.5),
    );
  }
}

/// Fades and slides a child in once, optionally after a staggered delay.
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({super.key, required this.child, this.index = 0, this.offset = 18});
  final Widget child;
  final int index;
  final double offset;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 420));
  late final Animation<double> _a = CurvedAnimation(parent: _c, curve: Curves.easeOutCubic);

  @override
  void initState() {
    super.initState();
    Future.delayed(Duration(milliseconds: 35 * math.min(widget.index, 12)), () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _a,
      builder: (_, child) => Opacity(
        opacity: _a.value,
        child: Transform.translate(offset: Offset(0, widget.offset * (1 - _a.value)), child: child),
      ),
      child: widget.child,
    );
  }
}

class GradientBadge extends StatelessWidget {
  const GradientBadge(this.text, {super.key, this.muted = false});
  final String text;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Container(
      constraints: const BoxConstraints(minWidth: 22),
      height: 22,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: muted ? null : p.gradient,
        color: muted ? p.subtext.withValues(alpha: 0.35) : null,
        borderRadius: BorderRadius.circular(11),
      ),
      child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

/// A grouped settings-style card.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, required this.children});
  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (title != null)
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
          child: Text(title!.toUpperCase(),
              style: TextStyle(color: p.subtext, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.1)),
        ),
      Container(
        margin: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: p.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, indent: 64, color: p.border),
            children[i],
          ],
        ]),
      ),
    ]);
  }
}

class SettingsTile extends StatelessWidget {
  const SettingsTile({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.gradient,
    this.destructive = false,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Gradient? gradient;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(children: [
          GradientIcon(icon,
              size: 36,
              gradient: destructive
                  ? LinearGradient(colors: [p.danger, const Color(0xfffb7185)])
                  : gradient),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title,
                  style: TextStyle(
                      color: destructive ? p.danger : p.text, fontSize: 15.5, fontWeight: FontWeight.w600)),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(subtitle!, style: TextStyle(color: p.subtext, fontSize: 12.5)),
                ),
            ]),
          ),
          if (trailing != null) trailing! else if (onTap != null) Icon(Icons.chevron_right_rounded, color: p.subtext),
        ]),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: FadeSlideIn(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 104,
              height: 104,
              decoration: BoxDecoration(
                gradient: p.gradient,
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: p.primary.withValues(alpha: 0.35), blurRadius: 40, offset: const Offset(0, 16))],
              ),
              child: Icon(icon, color: Colors.white, size: 46),
            ),
            const SizedBox(height: 24),
            Text(title, style: TextStyle(color: p.text, fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: TextStyle(color: p.subtext, height: 1.5)),
            if (action != null) ...[const SizedBox(height: 24), action!],
          ]),
        ),
      ),
    );
  }
}
