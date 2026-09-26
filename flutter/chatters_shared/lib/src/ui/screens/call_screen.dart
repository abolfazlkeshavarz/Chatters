import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../services/call_service.dart';
import '../l10n.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/design.dart';

String formatDuration(Duration d) {
  final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return n(d.inHours > 0 ? '${d.inHours}:$m:$s' : '$m:$s');
}

String callStatusText(CallService c) => switch (c.phase) {
      CallPhase.outgoing => t('Calling…'),
      CallPhase.ringing => t('Ringing…'),
      CallPhase.incoming => t('Incoming voice call'),
      CallPhase.connecting => t('Connecting…'),
      CallPhase.active => c.connectedAt == null ? '' : formatDuration(DateTime.now().difference(c.connectedAt!)),
      CallPhase.ended => switch (c.endReason) {
          CallEndReason.declined => t('Call declined'),
          CallEndReason.busy => t('Busy on another call'),
          CallEndReason.unavailable => t('Not reachable right now'),
          CallEndReason.noAnswer => t('No answer'),
          CallEndReason.failed => t('Could not connect'),
          CallEndReason.answeredElsewhere => t('Answered on another device'),
          _ => t('Call ended'),
        },
      CallPhase.idle => '',
    };

class CallScreen extends StatefulWidget {
  const CallScreen({super.key});

  /// True while the screen is on top, so the app does not also show the
  /// "return to call" bar.
  static final visible = ValueNotifier<bool>(false);

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> with SingleTickerProviderStateMixin {
  final call = CallService.instance;
  late final AnimationController _pulse =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    CallScreen.visible.value = true;
    call.addListener(_changed);
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (call.phase == CallPhase.active && mounted) setState(() {});
    });
  }

  void _changed() {
    if (!mounted) return;
    if (call.phase == CallPhase.idle) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {});
  }

  @override
  void dispose() {
    CallScreen.visible.value = false;
    call.removeListener(_changed);
    _tick?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final peer = call.peer ?? '';
    final ringingish = call.phase == CallPhase.outgoing ||
        call.phase == CallPhase.ringing ||
        call.phase == CallPhase.incoming ||
        call.phase == CallPhase.connecting;

    return Scaffold(
      body: AuroraBackground(
        intensity: 1.4,
        child: SafeArea(
          child: Column(children: [
            Row(children: [
              IconButton(
                tooltip: t('Minimize'),
                icon: Icon(Icons.keyboard_arrow_down_rounded, color: p.text, size: 32),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              const Spacer(),
              Container(
                margin: const EdgeInsetsDirectional.only(end: 16),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: p.secure.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.lock_rounded, size: 14, color: p.secure),
                  const SizedBox(width: 6),
                  Text(t('End-to-end encrypted'),
                      style: TextStyle(color: p.secure, fontWeight: FontWeight.w700, fontSize: 12)),
                ]),
              ),
            ]),
            const Spacer(),
            SizedBox(
              width: 260,
              height: 260,
              child: AnimatedBuilder(
                animation: _pulse,
                builder: (_, child) => Stack(alignment: Alignment.center, children: [
                  if (ringingish)
                    for (var i = 0; i < 3; i++)
                      Builder(builder: (_) {
                        final v = (_pulse.value + i / 3) % 1;
                        return Opacity(
                          opacity: (1 - v) * 0.5,
                          child: Container(
                            width: 150 + 110 * v,
                            height: 150 + 110 * v,
                            decoration: BoxDecoration(shape: BoxShape.circle, gradient: p.gradient),
                          ),
                        );
                      }),
                  if (call.phase == CallPhase.active)
                    Container(
                      width: 170 + 8 * math.sin(_pulse.value * 2 * math.pi),
                      height: 170 + 8 * math.sin(_pulse.value * 2 * math.pi),
                      decoration: BoxDecoration(shape: BoxShape.circle, gradient: p.secureGradient),
                    ),
                  child!,
                ]),
                child: UserAvatar(userId: peer, size: 150),
              ),
            ),
            const SizedBox(height: 28),
            Text(peer, style: TextStyle(color: p.text, fontSize: 30, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: Text(
                callStatusText(call),
                key: ValueKey(call.phase),
                style: TextStyle(
                  color: call.phase == CallPhase.active ? p.secure : p.subtext,
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 0, 28, 36),
              child: call.phase == CallPhase.incoming ? _incomingButtons(p) : _activeButtons(p),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _incomingButtons(Palette p) {
    return Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
      _RoundButton(
        icon: Icons.call_end_rounded,
        label: t('Decline'),
        gradient: LinearGradient(colors: [const Color(0xfffb7185), p.danger]),
        onTap: call.decline,
      ),
      _RoundButton(
        icon: Icons.call_rounded,
        label: t('Accept'),
        gradient: p.secureGradient,
        onTap: call.accept,
        pulse: true,
      ),
    ]);
  }

  Widget _activeButtons(Palette p) {
    final ended = call.phase == CallPhase.ended;
    return Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
      _RoundButton(
        icon: call.muted ? Icons.mic_off_rounded : Icons.mic_rounded,
        label: call.muted ? t('Unmute') : t('Mute'),
        selected: call.muted,
        onTap: ended ? null : call.toggleMute,
      ),
      _RoundButton(
        icon: Icons.call_end_rounded,
        label: t('End'),
        gradient: LinearGradient(colors: [const Color(0xfffb7185), p.danger]),
        size: 78,
        onTap: ended ? null : call.hangUp,
      ),
      _RoundButton(
        icon: call.speaker ? Icons.volume_up_rounded : Icons.hearing_rounded,
        label: t('Speaker'),
        selected: call.speaker,
        onTap: ended ? null : call.toggleSpeaker,
      ),
    ]);
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.icon,
    required this.label,
    this.onTap,
    this.gradient,
    this.selected = false,
    this.size = 66,
    this.pulse = false,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Gradient? gradient;
  final bool selected;
  final double size;
  final bool pulse;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final filled = gradient != null;
    return Opacity(
      opacity: onTap == null ? 0.45 : 1,
      child: Pressable(
        onTap: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: gradient,
              color: filled ? null : (selected ? p.text : p.surface.withValues(alpha: p.dark ? 0.35 : 0.7)),
              boxShadow: filled
                  ? [BoxShadow(color: (gradient as LinearGradient).colors.last.withValues(alpha: 0.45), blurRadius: 24, offset: const Offset(0, 10))]
                  : null,
            ),
            child: Icon(icon, size: size * 0.42, color: filled ? Colors.white : (selected ? p.bg : p.text)),
          ),
          const SizedBox(height: 10),
          Text(label, style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
        ]),
      ),
    );
  }
}

/// A green bar shown over the app while a call runs with its screen minimized.
class ReturnToCallBar extends StatefulWidget {
  const ReturnToCallBar({super.key, required this.onTap});
  final VoidCallback onTap;

  @override
  State<ReturnToCallBar> createState() => _ReturnToCallBarState();
}

class _ReturnToCallBarState extends State<ReturnToCallBar> {
  final call = CallService.instance;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => mounted ? setState(() {}) : null);
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Material(
      color: Colors.transparent,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
          child: Pressable(
            onTap: widget.onTap,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                gradient: p.secureGradient,
                borderRadius: BorderRadius.circular(20),
                boxShadow: [BoxShadow(color: p.secure.withValues(alpha: 0.4), blurRadius: 16, offset: const Offset(0, 6))],
              ),
              child: Row(children: [
                const Icon(Icons.call_rounded, color: Colors.white, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('${call.peer ?? ''} · ${callStatusText(call)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                ),
                Text(t('Tap to return'), style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 12.5)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
