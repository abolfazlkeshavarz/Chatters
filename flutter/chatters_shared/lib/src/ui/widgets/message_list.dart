import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api/client.dart';
import '../../api/endpoints.dart';
import '../theme.dart';
import 'avatar.dart';
import 'common.dart';
import 'design.dart';
import '../l10n.dart';

bool isMedia(Map m) => m['type'] == 'media' || m['has_file'] == true || m['filename'] != null;

bool isImage(Map m) {
  final mime = m['mime_type'] as String?;
  if (mime != null) return mime.startsWith('image/');
  final name = (m['filename'] ?? m['content'] ?? '') as String;
  return RegExp(r'\.(jpe?g|png|gif|bmp|webp|avif)$', caseSensitive: false).hasMatch(name);
}

bool isSystem(Map m) =>
    m['type'] == 'system' || m['is_system'] == true || (m['from'] == null && m['is_encrypted'] != true);

String messagePreview(Map m) =>
    isMedia(m) ? (isImage(m) ? t('📷 Photo') : '📎 ${m['filename'] ?? m['content'] ?? t('File')}') : '${m['content'] ?? ''}';

/// 1–3 emoji and nothing else: rendered large, without a bubble.
bool _emojiOnly(String s) {
  final t = s.trim();
  if (t.isEmpty || t.characters.length > 3) return false;
  return !RegExp(r'[\p{L}\p{N}\p{P}\s]', unicode: true).hasMatch(t);
}

String? _countdown(String expiresAt, DateTime now) {
  final end = DateTime.tryParse(expiresAt);
  if (end == null) return null;
  final secs = (end.difference(now).inMilliseconds / 1000).ceil();
  if (secs <= 0) return null;
  if (secs < 60) return t('{n}s', {'n': secs});
  if (secs < 3600) return t('{n}m', {'n': (secs / 60).ceil()});
  if (secs < 86400) return t('{n}h', {'n': (secs / 3600).ceil()});
  return t('{n}d', {'n': (secs / 86400).ceil()});
}

String _dayLabel(DateTime d) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final diff = today.difference(DateTime(d.year, d.month, d.day)).inDays;
  if (diff == 0) return t('Today');
  if (diff == 1) return t('Yesterday');
  if (diff < 7) return DateFormat.EEEE().format(d);
  if (d.year == now.year) return DateFormat.MMMMd().format(d);
  return DateFormat.yMMMd().format(d);
}

class _Entry {
  _Entry.day(this.day) : m = null;
  _Entry.msg(this.m) : day = null;
  final String? day;
  final Map<String, dynamic>? m;
  bool first = true, last = true;
}

class MessageList extends StatefulWidget {
  const MessageList({
    super.key,
    required this.messages,
    required this.me,
    required this.onReply,
    required this.onDelete,
    this.secure = false,
    this.group = false,
    this.header,
    this.bottomPadding = 0,
  });

  final List<Map<String, dynamic>> messages;
  final String? me;
  final bool secure;
  final bool group;
  final Widget? header;
  final double bottomPadding;
  final void Function(Map<String, dynamic>) onReply;
  final Future<void> Function(Map<String, dynamic>, String scope) onDelete;

  @override
  State<MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<MessageList> {
  final _scroll = ScrollController();
  Timer? _ticker;
  DateTime _now = DateTime.now();
  Set<Object?>? _initialIds;
  bool _showJump = false;
  int _newWhileAway = 0;

  @override
  void initState() {
    super.initState();
    _syncTicker();
    _scroll.addListener(() {
      final away = _scroll.offset > 400;
      if (away != _showJump) {
        setState(() {
          _showJump = away;
          if (!away) _newWhileAway = 0;
        });
      }
    });
  }

  @override
  void didUpdateWidget(covariant MessageList old) {
    super.didUpdateWidget(old);
    _syncTicker();
    if (_showJump && widget.messages.length > old.messages.length) {
      final added = widget.messages.length - old.messages.length;
      final fromOthers = widget.messages.reversed.take(added).any((m) => m['from'] != widget.me);
      if (fromOthers) _newWhileAway += added;
    }
  }

  /// Ticks self-destruct countdowns and hides a message the moment its timer
  /// elapses, ahead of the server's sweep broadcast.
  void _syncTicker() {
    final hasTimers = widget.messages.any((m) => m['expires_at'] != null);
    if (hasTimers && _ticker == null) {
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _now = DateTime.now()));
    } else if (!hasTimers) {
      _ticker?.cancel();
      _ticker = null;
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  List<_Entry> _entries(List<Map<String, dynamic>> msgs) {
    final out = <_Entry>[];
    String? lastDay;
    Map<String, dynamic>? prev;
    for (final m in msgs) {
      final t = DateTime.tryParse('${m['created_at']}')?.toLocal();
      final day = t == null ? null : _dayLabel(t);
      if (day != null && day != lastDay) {
        out.add(_Entry.day(day));
        lastDay = day;
        prev = null;
      }
      final e = _Entry.msg(m);
      if (prev != null && !isSystem(m) && !isSystem(prev) && prev['from'] == m['from']) {
        final pt = DateTime.tryParse('${prev['created_at']}');
        final ct = DateTime.tryParse('${m['created_at']}');
        if (pt != null && ct != null && ct.difference(pt).inMinutes < 3) {
          e.first = false;
          (out.last).last = false;
        }
      }
      out.add(e);
      prev = m;
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final visible = widget.messages.where((m) {
      final e = m['expires_at'] as String?;
      if (e == null) return true;
      final t = DateTime.tryParse(e);
      return t == null || t.isAfter(_now);
    }).toList();
    _initialIds ??= widget.messages.map((m) => m['id']).toSet();
    final byId = {for (final m in widget.messages) m['id']: m};
    final entries = _entries(visible).reversed.toList();
    final hasHeader = widget.header != null;

    return Stack(children: [
      if (visible.isEmpty)
        Center(
          child: FadeSlideIn(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (hasHeader) widget.header!,
              const Text('👋', style: TextStyle(fontSize: 64)),
              const SizedBox(height: 12),
              Text(t('No messages yet'), style: TextStyle(color: p.text, fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(t('Say hi and break the ice'), style: TextStyle(color: p.subtext)),
            ]),
          ),
        )
      else
        ListView.builder(
          controller: _scroll,
          reverse: true,
          physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
          padding: EdgeInsets.fromLTRB(10, 8, 10, 8 + widget.bottomPadding),
          itemCount: entries.length + (hasHeader ? 1 : 0),
          itemBuilder: (_, i) {
            if (i == entries.length) return widget.header!;
            final e = entries[i];
            if (e.day != null) return _dayChip(e.day!);
            final m = e.m!;
            final bubble = _row(m, e, m['reply_to'] != null ? byId[m['reply_to']] : null);
            if (_initialIds!.contains(m['id'])) return bubble;
            return _Appear(key: ValueKey('appear-${m['id']}'), mine: m['from'] == widget.me, child: bubble);
          },
        ),
      Positioned(
        right: 14,
        bottom: 14 + widget.bottomPadding,
        child: AnimatedScale(
          scale: _showJump ? 1 : 0,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutBack,
          child: Pressable(
            onTap: () => _scroll.animateTo(0, duration: const Duration(milliseconds: 450), curve: Curves.easeOutCubic),
            child: Stack(clipBehavior: Clip.none, children: [
              Glass(
                radius: 24,
                child: SizedBox(width: 46, height: 46, child: Icon(Icons.keyboard_arrow_down_rounded, color: p.text, size: 28)),
              ),
              if (_newWhileAway > 0)
                Positioned(top: -6, right: -4, child: GradientBadge(n(_newWhileAway))),
            ]),
          ),
        ),
      ),
    ]);
  }

  Widget _dayChip(String label) {
    final p = context.p;
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 12),
        child: Glass(
          radius: 14,
          blur: 12,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          child: Text(label, style: TextStyle(color: p.text, fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }

  Widget _row(Map<String, dynamic> m, _Entry e, Map<String, dynamic>? replied) {
    final p = context.p;
    if (isSystem(m)) {
      return Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 24),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: BoxDecoration(color: p.primary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
          child: Text('${m['content'] ?? ''}',
              textAlign: TextAlign.center,
              style: TextStyle(color: p.primary, fontSize: 12.5, fontWeight: FontWeight.w600)),
        ),
      );
    }
    final mine = m['from'] == widget.me;
    final showAvatar = widget.group && !mine;
    return _SwipeToReply(
      mine: mine,
      onReply: () => widget.onReply(m),
      child: Padding(
        padding: EdgeInsets.only(top: e.first ? 6 : 1.5, bottom: e.last ? 2 : 0),
        child: Row(
          mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (showAvatar)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: e.last ? UserAvatar(userId: '${m['from']}', size: 30) : const SizedBox(width: 30),
              ),
            Flexible(child: _bubble(m, e, replied, mine)),
          ],
        ),
      ),
    );
  }

  Widget _bubble(Map<String, dynamic> m, _Entry e, Map<String, dynamic>? replied, bool mine) {
    final p = context.p;
    final status = (m['status'] as String?) ?? 'sent';
    final text = '${m['content'] ?? ''}';
    final media = isMedia(m);
    final image = media && isImage(m);
    final emoji = !media && m['decryptError'] == null && replied == null && _emojiOnly(text);
    final fg = mine ? Colors.white : p.bubbleInText;
    final created = DateTime.tryParse('${m['created_at']}')?.toLocal();
    final countdown = m['expires_at'] != null ? _countdown(m['expires_at'] as String, _now) : null;

    const r = Radius.circular(22);
    const small = Radius.circular(6);
    // Directional, so the tail side mirrors in right-to-left languages.
    final radius = BorderRadiusDirectional.only(
      topStart: !mine && !e.first ? small : r,
      bottomStart: !mine && !e.last ? small : (!mine ? small : r),
      topEnd: mine && !e.first ? small : r,
      bottomEnd: mine && !e.last ? small : (mine ? small : r),
    );

    final meta = Row(mainAxisSize: MainAxisSize.min, children: [
      if (countdown != null) ...[
        Icon(Icons.local_fire_department_rounded, size: 12, color: emoji || image ? p.warn : fg.withValues(alpha: 0.85)),
        Text(countdown, style: TextStyle(color: emoji ? p.subtext : fg.withValues(alpha: 0.8), fontSize: 11)),
        const SizedBox(width: 4),
      ],
      if (widget.secure) ...[
        Icon(Icons.lock_rounded, size: 10, color: emoji ? p.subtext : fg.withValues(alpha: 0.7)),
        const SizedBox(width: 3),
      ],
      if (created != null)
        Text(DateFormat.Hm().format(created),
            style: TextStyle(color: emoji ? p.subtext : fg.withValues(alpha: 0.75), fontSize: 11)),
      if (mine) ...[
        const SizedBox(width: 3),
        Icon(
          status == 'sent' ? Icons.done_rounded : Icons.done_all_rounded,
          size: 15,
          color: status == 'seen'
              ? (emoji ? p.primary : const Color(0xffa5f3fc))
              : (emoji ? p.subtext : fg.withValues(alpha: 0.75)),
        ),
      ],
    ]);

    if (emoji) {
      return GestureDetector(
        onLongPress: () => _actions(m, mine),
        child: Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
          Text(text, style: const TextStyle(fontSize: 52, height: 1.15)),
          meta,
        ]),
      );
    }

    Widget body;
    if (m['decryptError'] != null) {
      body = Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.lock_clock_rounded, size: 16, color: fg.withValues(alpha: 0.8)),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            m['decryptError'] == 'locked' ? t('Unlock secure chat to read this') : t('Sent to a different key — cannot decrypt'),
            style: TextStyle(color: fg.withValues(alpha: 0.85), fontStyle: FontStyle.italic),
          ),
        ),
      ]);
    } else if (image) {
      body = _ImageBody(id: m['id'] as int, name: '${m['filename'] ?? m['content'] ?? 'image'}');
    } else if (media) {
      body = _FileBody(id: m['id'] as int, name: '${m['filename'] ?? m['content'] ?? 'file'}', fg: fg, mine: mine);
    } else {
      body = Text(text, textDirection: dirOf(text), style: TextStyle(color: fg, fontSize: 15.5, height: 1.35));
    }

    final showName = widget.group && !mine && e.first;
    final nameColor = gradientFor('${m['from']}').colors.first;

    return GestureDetector(
      onLongPress: () => _actions(m, mine),
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        padding: image ? const EdgeInsets.all(4) : const EdgeInsets.fromLTRB(14, 9, 12, 7),
        decoration: BoxDecoration(
          gradient: mine ? (widget.secure ? p.secureGradient : p.gradient) : null,
          color: mine ? null : p.bubbleIn,
          borderRadius: radius,
          boxShadow: [
            BoxShadow(
              color: mine ? p.primary.withValues(alpha: 0.22) : Colors.black.withValues(alpha: p.dark ? 0.25 : 0.05),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          if (showName)
            Padding(
              padding: EdgeInsets.fromLTRB(image ? 8 : 0, image ? 4 : 0, 0, 3),
              child: Text('${m['from']}', style: TextStyle(color: nameColor, fontSize: 13, fontWeight: FontWeight.w700)),
            ),
          if (replied != null) _quote(replied, fg, mine),
          body,
          Padding(
            padding: image ? const EdgeInsets.fromLTRB(0, 4, 6, 2) : const EdgeInsets.only(top: 3),
            child: Align(alignment: AlignmentDirectional.bottomEnd, widthFactor: 1, child: meta),
          ),
        ]),
      ),
    );
  }

  Widget _quote(Map<String, dynamic> replied, Color fg, bool mine) {
    final p = context.p;
    final accent = mine ? Colors.white : p.primary;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
      decoration: BoxDecoration(
        color: mine ? Colors.white.withValues(alpha: 0.18) : p.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: BorderDirectional(start: BorderSide(color: accent, width: 3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('${replied['from']}', style: TextStyle(color: accent, fontSize: 12.5, fontWeight: FontWeight.w700)),
        Text(messagePreview(replied),
            textDirection: dirOf(messagePreview(replied)),
            maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: fg.withValues(alpha: 0.85), fontSize: 13)),
      ]),
    );
  }

  void _actions(Map<String, dynamic> m, bool mine) {
    HapticFeedback.mediumImpact();
    final p = context.p;
    final canEveryone = mine || widget.secure;
    final canCopy = !isMedia(m) && m['decryptError'] == null;
    showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: p.surfaceHigh, borderRadius: BorderRadius.circular(18)),
              child: Text(messagePreview(m),
                  maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.text, fontSize: 15)),
            ),
            const SizedBox(height: 14),
            Row(children: [
              _ActionButton(Icons.reply_rounded, t('Reply'), p.gradient, () {
                Navigator.pop(c);
                widget.onReply(m);
              }),
              if (canCopy)
                _ActionButton(Icons.copy_rounded, t('Copy'),
                    const LinearGradient(colors: [Color(0xff2563eb), Color(0xff06b6d4)]), () {
                  Clipboard.setData(ClipboardData(text: '${m['content'] ?? ''}'));
                  Navigator.pop(c);
                  toast(context, t('Copied to clipboard'));
                }),
              if (isMedia(m))
                _ActionButton(Icons.ios_share_rounded, t('Share'),
                    const LinearGradient(colors: [Color(0xff2563eb), Color(0xff06b6d4)]), () {
                  Navigator.pop(c);
                  shareAttachment(context, m['id'] as int, '${m['filename'] ?? m['content'] ?? 'file'}');
                }),
              _ActionButton(Icons.delete_outline_rounded, t('Delete\nfor me'),
                  LinearGradient(colors: [p.warn, const Color(0xfffbbf24)]), () {
                Navigator.pop(c);
                widget.onDelete(m, 'me');
              }),
              if (canEveryone)
                _ActionButton(Icons.delete_forever_rounded, t('Delete for\neveryone'),
                    LinearGradient(colors: [const Color(0xfffb7185), p.danger]), () {
                  Navigator.pop(c);
                  widget.onDelete(m, 'everyone');
                }),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton(this.icon, this.label, this.gradient, this.onTap);
  final IconData icon;
  final String label;
  final Gradient gradient;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Pressable(
        onTap: onTap,
        child: Column(children: [
          GradientIcon(icon, size: 52, gradient: gradient, radius: 18),
          const SizedBox(height: 6),
          Text(label,
              textAlign: TextAlign.center,
              style: TextStyle(color: context.p.text, fontSize: 11.5, fontWeight: FontWeight.w600, height: 1.2)),
        ]),
      ),
    );
  }
}

/// Pops a newly arrived message in from its side.
class _Appear extends StatefulWidget {
  const _Appear({super.key, required this.child, required this.mine});
  final Widget child;
  final bool mine;
  @override
  State<_Appear> createState() => _AppearState();
}

class _AppearState extends State<_Appear> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 380))..forward();
  late final Animation<double> _a = CurvedAnimation(parent: _c, curve: Curves.easeOutBack);

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
        opacity: _c.value,
        child: Transform.scale(
          scale: 0.85 + 0.15 * _a.value,
          alignment: widget.mine ? AlignmentDirectional.bottomEnd : AlignmentDirectional.bottomStart,
          child: Transform.translate(offset: Offset(0, 16 * (1 - _a.value)), child: child),
        ),
      ),
      child: widget.child,
    );
  }
}

/// Drag a message sideways to reply, like in every modern messenger.
class _SwipeToReply extends StatefulWidget {
  const _SwipeToReply({required this.child, required this.onReply, required this.mine});
  final Widget child;
  final VoidCallback onReply;
  final bool mine;
  @override
  State<_SwipeToReply> createState() => _SwipeToReplyState();
}

class _SwipeToReplyState extends State<_SwipeToReply> with SingleTickerProviderStateMixin {
  static const _threshold = 64.0;
  double _dx = 0;
  bool _armed = false;
  late final AnimationController _back = AnimationController(vsync: this, duration: const Duration(milliseconds: 220))
    ..addListener(() => setState(() => _dx = _from * (1 - Curves.easeOut.transform(_back.value))));
  double _from = 0;

  @override
  void dispose() {
    _back.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final progress = (_dx.abs() / _threshold).clamp(0.0, 1.0);
    return GestureDetector(
      onHorizontalDragUpdate: (d) {
        // Swipe away from the bubble's own side; mirrored in RTL.
        final rtl = isRtl;
        final negative = widget.mine != rtl;
        final next = (_dx + d.delta.dx).clamp(negative ? -90.0 : 0.0, negative ? 0.0 : 90.0);
        setState(() => _dx = next);
        final armed = _dx.abs() >= _threshold;
        if (armed && !_armed) HapticFeedback.lightImpact();
        _armed = armed;
      },
      onHorizontalDragEnd: (_) {
        if (_armed) widget.onReply();
        _armed = false;
        _from = _dx;
        _back.forward(from: 0);
      },
      child: Stack(alignment: widget.mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart, children: [
        PositionedDirectional(
          start: widget.mine ? null : 4,
          end: widget.mine ? 4 : null,
          child: Opacity(
            opacity: progress,
            child: Transform.scale(
              scale: 0.5 + 0.5 * progress,
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(gradient: p.gradient, shape: BoxShape.circle),
                child: const Icon(Icons.reply_rounded, color: Colors.white, size: 18),
              ),
            ),
          ),
        ),
        Transform.translate(offset: Offset(_dx, 0), child: widget.child),
      ]),
    );
  }
}

class _ImageBody extends StatelessWidget {
  const _ImageBody({required this.id, required this.name});
  final int id;
  final String name;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        PageRouteBuilder(
          opaque: false,
          pageBuilder: (_, __, ___) => ImageViewer(messageId: id, filename: name),
          transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
        ),
      ),
      child: Hero(
        tag: 'media-$id',
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: Image.network(
            mediaUrl(id),
            headers: Api.authHeader(),
            width: 240,
            fit: BoxFit.cover,
            frameBuilder: (_, child, frame, sync) => AnimatedOpacity(
              opacity: frame == null && !sync ? 0 : 1,
              duration: const Duration(milliseconds: 300),
              child: child,
            ),
            loadingBuilder: (_, child, progress) => progress == null
                ? child
                : Container(
                    width: 240,
                    height: 180,
                    color: p.surfaceHigh,
                    alignment: Alignment.center,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      value: progress.expectedTotalBytes == null
                          ? null
                          : progress.cumulativeBytesLoaded / progress.expectedTotalBytes!,
                    ),
                  ),
            errorBuilder: (_, __, ___) => Container(
              width: 240,
              height: 120,
              color: p.surfaceHigh,
              alignment: Alignment.center,
              child: Icon(Icons.broken_image_rounded, color: p.subtext, size: 36),
            ),
          ),
        ),
      ),
    );
  }
}

class _FileBody extends StatefulWidget {
  const _FileBody({required this.id, required this.name, required this.fg, required this.mine});
  final int id;
  final String name;
  final Color fg;
  final bool mine;
  @override
  State<_FileBody> createState() => _FileBodyState();
}

class _FileBodyState extends State<_FileBody> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final ext = widget.name.contains('.') ? widget.name.split('.').last.toUpperCase() : 'FILE';
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: _busy
          ? null
          : () async {
              setState(() => _busy = true);
              await shareAttachment(context, widget.id, widget.name);
              if (mounted) setState(() => _busy = false);
            },
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: widget.mine ? Colors.white.withValues(alpha: 0.22) : null,
            gradient: widget.mine ? null : p.gradient,
            borderRadius: BorderRadius.circular(14),
          ),
          child: _busy
              ? const Padding(padding: EdgeInsets.all(13), child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.insert_drive_file_rounded, color: Colors.white),
        ),
        const SizedBox(width: 10),
        Flexible(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: widget.fg, fontWeight: FontWeight.w600)),
            Text(t('{ext} · Tap to open', {'ext': ext}), style: TextStyle(color: widget.fg.withValues(alpha: 0.7), fontSize: 12)),
          ]),
        ),
      ]),
    );
  }
}

/// Download an attachment to a temp file and open the OS share sheet
/// (save to Files / Downloads, open in another app).
Future<void> shareAttachment(BuildContext context, int messageId, String filename) async {
  try {
    final bytes = await Api.bytes('/api/media/$messageId');
    final dir = await getTemporaryDirectory();
    final safe = filename.replaceAll(RegExp(r'[/\\]'), '_');
    final f = File('${dir.path}/$safe');
    await f.writeAsBytes(bytes, flush: true);
    await Share.shareXFiles([XFile(f.path)]);
  } catch (e) {
    if (context.mounted) toast(context, t('Download failed: {error}', {'error': errText(e)}), error: true);
  }
}

class ImageViewer extends StatefulWidget {
  const ImageViewer({super.key, required this.messageId, required this.filename});
  final int messageId;
  final String filename;
  @override
  State<ImageViewer> createState() => _ImageViewerState();
}

class _ImageViewerState extends State<ImageViewer> {
  double _drag = 0;

  @override
  Widget build(BuildContext context) {
    final fade = (1 - (_drag.abs() / 300)).clamp(0.0, 1.0);
    return Scaffold(
      backgroundColor: Colors.black.withValues(alpha: fade),
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: Text(widget.filename, style: const TextStyle(fontSize: 14, color: Colors.white)),
        actions: [
          IconButton(
            icon: const Icon(Icons.ios_share_rounded),
            onPressed: () => shareAttachment(context, widget.messageId, widget.filename),
          ),
        ],
      ),
      body: GestureDetector(
        onVerticalDragUpdate: (d) => setState(() => _drag += d.delta.dy),
        onVerticalDragEnd: (_) {
          if (_drag.abs() > 120) {
            Navigator.pop(context);
          } else {
            setState(() => _drag = 0);
          }
        },
        child: Center(
          child: Transform.translate(
            offset: Offset(0, _drag),
            child: Hero(
              tag: 'media-${widget.messageId}',
              child: InteractiveViewer(
                maxScale: 5,
                child: Image.network(mediaUrl(widget.messageId), headers: Api.authHeader()),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
