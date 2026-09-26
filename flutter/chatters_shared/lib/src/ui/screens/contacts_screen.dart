import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/stores.dart';
import '../navigation.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';
import 'new_chat_sheet.dart';

class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});
  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  String _query = '';

  void _actions(String id) {
    final p = context.p;
    showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            UserAvatar(userId: id, size: 84, ring: true),
            const SizedBox(height: 12),
            Text(id, style: TextStyle(color: p.text, fontSize: 22, fontWeight: FontWeight.w800)),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(children: [
                Expanded(
                  child: _QuickAction(Icons.chat_bubble_rounded, 'Message', p.gradient, () {
                    Navigator.pop(c);
                    openDirectChat(context, id);
                  }),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _QuickAction(Icons.lock_rounded, 'Secret chat', p.secureGradient, () {
                    Navigator.pop(c);
                    openDirectChat(context, id, secret: true);
                  }),
                ),
              ]),
            ),
            const SizedBox(height: 12),
            SettingsTile(
              icon: Icons.person_remove_rounded,
              title: 'Remove from contacts',
              destructive: true,
              onTap: () async {
                Navigator.pop(c);
                if (await confirm(context, 'Remove $id?', 'Your chats with them stay.',
                    ok: 'Remove', destructive: true)) {
                  ContactsStore.instance.remove(id);
                }
              },
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      body: ListenableBuilder(
        listenable: ContactsStore.instance,
        builder: (context, _) {
          final all = ContactsStore.instance.contacts.map((c) => c['id'] as String).toList()
            ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
          final list = all.where((id) => id.toLowerCase().contains(_query.toLowerCase())).toList();
          return RefreshIndicator(
            edgeOffset: 120,
            onRefresh: () {
              HapticFeedback.mediumImpact();
              return ContactsStore.instance.load();
            },
            child: CustomScrollView(
              physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
              slivers: [
                SliverAppBar(
                  pinned: true,
                  expandedHeight: 116,
                  backgroundColor: p.bg.withValues(alpha: 0.92),
                  flexibleSpace: const FlexibleSpaceBar(
                    titlePadding: EdgeInsetsDirectional.only(start: 20, bottom: 14),
                    title: GradientText('Contacts',
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.6)),
                    background: AuroraBackground(intensity: 0.45),
                  ),
                  actions: [
                    Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: IconButton.filled(
                        style: IconButton.styleFrom(backgroundColor: p.primary),
                        icon: const Icon(Icons.person_add_alt_1_rounded, color: Colors.white),
                        onPressed: () => addContactFlow(context),
                      ),
                    ),
                  ],
                ),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    child: TextField(
                      onChanged: (v) => setState(() => _query = v.trim()),
                      decoration: const InputDecoration(
                        hintText: 'Search contacts',
                        prefixIcon: Icon(Icons.search_rounded),
                        contentPadding: EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                ),
                if (ContactsStore.instance.loading && all.isEmpty)
                  const SliverFillRemaining(child: Center(child: CircularProgressIndicator()))
                else if (list.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: EmptyState(
                      icon: Icons.people_alt_rounded,
                      title: all.isEmpty ? 'Your circle is empty' : 'No matches',
                      message: all.isEmpty ? 'Add people by username or phone number to start chatting.' : 'Try another name.',
                      action: all.isEmpty
                          ? SizedBox(
                              width: 220,
                              child: GradientButton(
                                  label: 'Add contact',
                                  icon: Icons.person_add_alt_1_rounded,
                                  onPressed: () => addContactFlow(context)))
                          : null,
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 140),
                    sliver: SliverList.builder(
                      itemCount: list.length,
                      itemBuilder: (_, i) {
                        final id = list[i];
                        final letter = id.characters.first.toUpperCase();
                        final showHeader = i == 0 || list[i - 1].characters.first.toUpperCase() != letter;
                        return FadeSlideIn(
                          index: i,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            if (showHeader)
                              Padding(
                                padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                                child: GradientText(letter,
                                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                              ),
                            Pressable(
                              scale: 0.98,
                              onTap: () => _actions(id),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                child: Row(children: [
                                  UserAvatar(userId: id, size: 50),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Text(id,
                                        style: TextStyle(color: p.text, fontSize: 16, fontWeight: FontWeight.w600)),
                                  ),
                                  IconButton(
                                    icon: Icon(Icons.chat_bubble_outline_rounded, color: p.primary),
                                    onPressed: () => openDirectChat(context, id),
                                  ),
                                ]),
                              ),
                            ),
                          ]),
                        );
                      },
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction(this.icon, this.label, this.gradient, this.onTap);
  final IconData icon;
  final String label;
  final Gradient gradient;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      child: Container(
        height: 64,
        decoration: BoxDecoration(gradient: gradient, borderRadius: BorderRadius.circular(20)),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, color: Colors.white),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12.5)),
        ]),
      ),
    );
  }
}
