import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/stores.dart';
import '../l10n.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';

/// "Developer & news": who makes Chatters, how to reach them, and news
/// posts — all written by the developer from the web admin panel.
class DeveloperScreen extends StatefulWidget {
  const DeveloperScreen({super.key});
  @override
  State<DeveloperScreen> createState() => _DeveloperScreenState();
}

class _DeveloperScreenState extends State<DeveloperScreen> {
  final store = DeveloperStore.instance;

  @override
  void initState() {
    super.initState();
    store.load().then((_) => store.markSeen());
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(),
      body: ListenableBuilder(
        listenable: store,
        builder: (context, _) {
          final prof = store.profile;
          final name = '${prof['name'] ?? ''}';
          final headline = '${prof['headline'] ?? ''}';
          final bio = '${prof['bio'] ?? ''}';
          final contacts = ((prof['contacts'] as List?) ?? []).cast<Map>();
          return RefreshIndicator(
            onRefresh: store.load,
            child: ListView(padding: EdgeInsets.zero, children: [
              SizedBox(
                height: 330,
                child: AuroraBackground(
                  intensity: 1.2,
                  child: SafeArea(
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(30),
                          boxShadow: [BoxShadow(color: p.primary.withValues(alpha: 0.35), blurRadius: 30, offset: const Offset(0, 12))],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(30),
                          child: Image.asset('assets/images/app_icon.png', package: 'chatters_shared', width: 104, height: 104),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(name.isEmpty ? 'Chatters' : name,
                          textDirection: dirOf(name),
                          style: TextStyle(color: p.text, fontSize: 26, fontWeight: FontWeight.w800)),
                      if (headline.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(24, 4, 24, 0),
                          child: Text(headline,
                              textAlign: TextAlign.center,
                              textDirection: dirOf(headline),
                              style: TextStyle(color: p.subtext, fontWeight: FontWeight.w600)),
                        ),
                    ]),
                  ),
                ),
              ),
              if (bio.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                  child: Text(bio,
                      textAlign: TextAlign.center,
                      textDirection: dirOf(bio),
                      style: TextStyle(color: p.text, height: 1.6, fontSize: 15)),
                ),
              if (contacts.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 10,
                    runSpacing: 10,
                    children: [for (final c in contacts) _ContactChip(c.cast<String, dynamic>())],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 28, 20, 8),
                child: Row(children: [
                  GradientText(t('News'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const Spacer(),
                  if (store.posts.isNotEmpty)
                    Text(n(store.posts.length), style: TextStyle(color: p.subtext, fontWeight: FontWeight.w600)),
                ]),
              ),
              if (store.loading)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else if (store.posts.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(children: [
                    Icon(Icons.newspaper_rounded, size: 44, color: p.subtext.withValues(alpha: 0.5)),
                    const SizedBox(height: 8),
                    Text(t('No news yet'), style: TextStyle(color: p.subtext)),
                  ]),
                )
              else
                for (var i = 0; i < store.posts.length; i++) FadeSlideIn(index: i, child: _PostCard(store.posts[i])),
              const SizedBox(height: 40),
            ]),
          );
        },
      ),
    );
  }
}

class _PostCard extends StatelessWidget {
  const _PostCard(this.post);
  final Map<String, dynamic> post;

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final title = '${post['title'] ?? ''}';
    final body = '${post['body'] ?? ''}';
    final emoji = '${post['emoji'] ?? ''}';
    final created = DateTime.tryParse('${post['created_at']}')?.toLocal();
    final pinned = post['pinned'] == true;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 6),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: pinned ? p.primary.withValues(alpha: 0.5) : p.border, width: pinned ? 1.5 : 1),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: p.primary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(15)),
          child: Text(emoji.isEmpty ? '📢' : emoji, style: const TextStyle(fontSize: 22)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (pinned) ...[Icon(Icons.push_pin_rounded, size: 15, color: p.primary), const SizedBox(width: 4)],
              if (created != null)
                Text(persianDigits(DateFormat.yMMMd().format(created)),
                    style: TextStyle(color: p.subtext, fontSize: 12, fontWeight: FontWeight.w600)),
            ]),
            if (title.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(title,
                    textDirection: dirOf(title),
                    style: TextStyle(color: p.text, fontWeight: FontWeight.w700, fontSize: 16.5)),
              ),
            if (body.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: SelectableText(body,
                    textDirection: dirOf(body), style: TextStyle(color: p.text.withValues(alpha: 0.85), height: 1.55)),
              ),
          ]),
        ),
      ]),
    );
  }
}

class _ContactChip extends StatelessWidget {
  const _ContactChip(this.c);
  final Map<String, dynamic> c;

  static final _brand = <String, (IconData, List<Color>)>{
    'email': (Icons.mail_rounded, [const Color(0xfff97316), const Color(0xffe11d48)]),
    'phone': (Icons.call_rounded, [const Color(0xff059669), const Color(0xff10b981)]),
    'whatsapp': (Icons.chat_rounded, [const Color(0xff16a34a), const Color(0xff22c55e)]),
    'website': (Icons.language_rounded, [const Color(0xff2563eb), const Color(0xff06b6d4)]),
    'telegram': (Icons.send_rounded, [const Color(0xff0ea5e9), const Color(0xff38bdf8)]),
    'instagram': (Icons.camera_alt_rounded, [const Color(0xffd946ef), const Color(0xfff97316)]),
    'github': (Icons.code_rounded, [const Color(0xff334155), const Color(0xff0f172a)]),
    'linkedin': (Icons.work_rounded, [const Color(0xff0a66c2), const Color(0xff2563eb)]),
    'x': (Icons.alternate_email_rounded, [const Color(0xff111827), const Color(0xff374151)]),
  };

  static const _names = {
    'email': 'Email', 'phone': 'Phone', 'whatsapp': 'WhatsApp', 'website': 'Website', 'telegram': 'Telegram',
    'instagram': 'Instagram', 'github': 'GitHub', 'linkedin': 'LinkedIn', 'x': 'X',
  };

  Uri? get _uri {
    final v = '${c['value'] ?? ''}'.trim();
    final handle = v.replaceFirst(RegExp(r'^@'), '');
    bool isUrl(String s) => RegExp(r'^https?://').hasMatch(s);
    switch (c['kind']) {
      case 'email':
        return Uri(scheme: 'mailto', path: v);
      case 'phone':
        return Uri(scheme: 'tel', path: v.replaceAll(RegExp(r'[^0-9+]'), ''));
      case 'whatsapp':
        return Uri.parse('https://wa.me/${v.replaceAll(RegExp(r'[^0-9]'), '')}');
      case 'website':
        return Uri.tryParse(isUrl(v) ? v : 'https://$v');
      case 'telegram':
        return Uri.tryParse(isUrl(v) ? v : 'https://t.me/$handle');
      case 'instagram':
        return Uri.tryParse(isUrl(v) ? v : 'https://instagram.com/$handle');
      case 'github':
        return Uri.tryParse(isUrl(v) ? v : 'https://github.com/$handle');
      case 'linkedin':
        return Uri.tryParse(isUrl(v) ? v : 'https://linkedin.com/in/$handle');
      case 'x':
        return Uri.tryParse(isUrl(v) ? v : 'https://x.com/$handle');
      default:
        return isUrl(v) ? Uri.tryParse(v) : null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final kind = '${c['kind'] ?? 'other'}';
    final (icon, colors) = _brand[kind] ?? (Icons.link_rounded, [p.accent.a, p.accent.b]);
    final value = '${c['value'] ?? ''}';
    final label = '${c['label'] ?? ''}'.isNotEmpty ? '${c['label']}' : (_names[kind] ?? value);
    return Pressable(
      onTap: () async {
        final uri = _uri;
        if (uri != null && await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } else {
          await Clipboard.setData(ClipboardData(text: value));
          if (context.mounted) toast(context, t('Copied to clipboard'));
        }
      },
      onLongPress: () {
        Clipboard.setData(ClipboardData(text: value));
        toast(context, t('Copied to clipboard'));
      },
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: p.border),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(gradient: LinearGradient(colors: colors), shape: BoxShape.circle),
            child: Icon(icon, color: Colors.white, size: 18),
          ),
          const SizedBox(width: 10),
          Text(label, style: TextStyle(color: p.text, fontWeight: FontWeight.w700)),
        ]),
      ),
    );
  }
}
