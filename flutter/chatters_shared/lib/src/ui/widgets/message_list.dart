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
import 'common.dart';

bool isMedia(Map m) => m['type'] == 'media' || m['has_file'] == true || m['filename'] != null;

bool isImage(Map m) {
  final mime = m['mime_type'] as String?;
  if (mime != null) return mime.startsWith('image/');
  final name = (m['filename'] ?? m['content'] ?? '') as String;
  return RegExp(r'\.(jpe?g|png|gif|bmp|webp|avif)$', caseSensitive: false).hasMatch(name);
}

bool isSystem(Map m) => m['type'] == 'system' || m['is_system'] == true || (m['from'] == null && m['is_encrypted'] != true);

String messagePreview(Map m) =>
    isMedia(m) ? '📎 ${m['filename'] ?? m['content'] ?? 'attachment'}' : '${m['content'] ?? ''}';

String? _countdown(String expiresAt, DateTime now) {
  final t = DateTime.tryParse(expiresAt);
  if (t == null) return null;
  final secs = (t.difference(now).inMilliseconds / 1000).ceil();
  if (secs <= 0) return null;
  if (secs < 60) return '${secs}s';
  if (secs < 3600) return '${(secs / 60).ceil()}m';
  if (secs < 86400) return '${(secs / 3600).ceil()}h';
  return '${(secs / 86400).ceil()}d';
}

const _statusLabel = {'sent': 'Sent', 'delivered': 'Delivered', 'seen': 'Read'};

class MessageList extends StatefulWidget {
  const MessageList({
    super.key,
    required this.messages,
    required this.me,
    required this.onReply,
    required this.onDelete,
    this.secure = false,
  });

  final List<Map<String, dynamic>> messages;
  final String? me;
  final bool secure;
  final void Function(Map<String, dynamic>) onReply;
  final Future<void> Function(Map<String, dynamic>, String scope) onDelete;

  @override
  State<MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<MessageList> {
  Timer? _ticker;
  DateTime _now = DateTime.now();

  @override
  void didUpdateWidget(covariant MessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncTicker();
  }

  @override
  void initState() {
    super.initState();
    _syncTicker();
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final visible = widget.messages.where((m) {
      final e = m['expires_at'] as String?;
      if (e == null) return true;
      final t = DateTime.tryParse(e);
      return t == null || t.isAfter(_now);
    }).toList();
    final byId = {for (final m in widget.messages) m['id']: m};

    if (visible.isEmpty) {
      return Center(child: Text('No messages yet — say hi 👋', style: TextStyle(color: context.p.subtext)));
    }

    // Reversed list keeps the view pinned to the newest message.
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      itemCount: visible.length,
      itemBuilder: (_, i) {
        final m = visible[visible.length - 1 - i];
        return _bubble(m, m['reply_to'] != null ? byId[m['reply_to']] : null);
      },
    );
  }

  Widget _bubble(Map<String, dynamic> m, Map<String, dynamic>? replied) {
    final p = context.p;
    if (isSystem(m)) {
      return Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(color: p.bubbleIn, borderRadius: BorderRadius.circular(12)),
          child: Text('${m['content'] ?? ''}', style: TextStyle(color: p.subtext, fontSize: 12)),
        ),
      );
    }

    final mine = m['from'] == widget.me;
    final status = (m['status'] as String?) ?? 'sent';
    Color bg, fg, border;
    if (!mine) {
      bg = p.bubbleIn;
      fg = p.bubbleInText;
      border = Colors.transparent;
    } else if (status == 'seen') {
      bg = p.success;
      fg = Colors.white;
      border = Colors.transparent;
    } else if (status == 'delivered') {
      bg = p.primary;
      fg = Colors.white;
      border = Colors.transparent;
    } else {
      bg = p.bubbleSent;
      fg = p.bubbleSentText;
      border = p.bubbleSentBorder;
    }

    final created = DateTime.tryParse('${m['created_at']}')?.toLocal();
    final countdown = m['expires_at'] != null ? _countdown(m['expires_at'] as String, _now) : null;
    final meta = [
      if (widget.secure) '🔒',
      if (created != null) DateFormat.Hm().format(created),
      if (countdown != null) '🔥 $countdown',
      if (mine) _statusLabel[status] ?? 'Sent',
    ].join('  ·  ');

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _actions(m, mine),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
          decoration: BoxDecoration(
            color: bg,
            border: Border.all(color: border),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (!mine)
              Text('${m['from']}', style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
            if (replied != null)
              Container(
                margin: const EdgeInsets.only(top: 4, bottom: 4),
                padding: const EdgeInsets.only(left: 8),
                decoration: BoxDecoration(border: Border(left: BorderSide(color: fg.withValues(alpha: 0.6), width: 2))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${replied['from']}', style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
                  Text(messagePreview(replied), maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: fg.withValues(alpha: 0.8), fontSize: 12)),
                ]),
              ),
            _body(m, fg),
            const SizedBox(height: 2),
            Text(meta, style: TextStyle(color: fg.withValues(alpha: 0.7), fontSize: 11)),
          ]),
        ),
      ),
    );
  }

  Widget _body(Map<String, dynamic> m, Color fg) {
    if (m['decryptError'] == 'locked') {
      return Text('🔒 Unlock secure chat to read this message', style: TextStyle(color: fg, fontStyle: FontStyle.italic));
    }
    if (m['decryptError'] == 'failed') {
      return Text('🔒 Cannot decrypt — this message was sent to a different key',
          style: TextStyle(color: fg, fontStyle: FontStyle.italic));
    }
    if (isMedia(m)) {
      final label = '${m['filename'] ?? m['content'] ?? 'attachment'}';
      final id = m['id'] as int;
      if (isImage(m)) {
        return GestureDetector(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ImageViewer(messageId: id, filename: label))),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.network(
              mediaUrl(id),
              headers: Api.authHeader(),
              width: 220,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Text('🖼️ $label', style: TextStyle(color: fg)),
            ),
          ),
        );
      }
      return InkWell(
        onTap: () => shareAttachment(context, id, label),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.insert_drive_file_outlined, color: fg),
          const SizedBox(width: 6),
          Flexible(child: Text(label, style: TextStyle(color: fg, decoration: TextDecoration.underline))),
        ]),
      );
    }
    return SelectableText('${m['content'] ?? ''}', style: TextStyle(color: fg, fontSize: 15));
  }

  void _actions(Map<String, dynamic> m, bool mine) {
    final canEveryone = mine || widget.secure;
    showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.reply),
            title: const Text('Reply'),
            onTap: () {
              Navigator.pop(c);
              widget.onReply(m);
            },
          ),
          if (!isMedia(m) && m['decryptError'] == null)
            ListTile(
              leading: const Icon(Icons.copy),
              title: const Text('Copy'),
              onTap: () {
                Clipboard.setData(ClipboardData(text: '${m['content'] ?? ''}'));
                Navigator.pop(c);
              },
            ),
          ListTile(
            leading: const Icon(Icons.delete_outline),
            title: const Text('Delete for me'),
            onTap: () {
              Navigator.pop(c);
              widget.onDelete(m, 'me');
            },
          ),
          if (canEveryone)
            ListTile(
              leading: Icon(Icons.delete_forever, color: context.p.danger),
              title: Text('Delete for everyone', style: TextStyle(color: context.p.danger)),
              onTap: () {
                Navigator.pop(c);
                widget.onDelete(m, 'everyone');
              },
            ),
        ]),
      ),
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
    if (context.mounted) toast(context, 'Download failed: $e');
  }
}

class ImageViewer extends StatelessWidget {
  const ImageViewer({super.key, required this.messageId, required this.filename});
  final int messageId;
  final String filename;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(filename, style: const TextStyle(fontSize: 14)),
        actions: [
          IconButton(icon: const Icon(Icons.ios_share), onPressed: () => shareAttachment(context, messageId, filename)),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          maxScale: 5,
          child: Image.network(mediaUrl(messageId), headers: Api.authHeader()),
        ),
      ),
    );
  }
}
