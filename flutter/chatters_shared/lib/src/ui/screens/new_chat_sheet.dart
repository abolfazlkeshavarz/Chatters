import 'package:flutter/material.dart';

import '../../api/endpoints.dart';
import '../../services/stores.dart';
import '../navigation.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/design.dart';

void showNewChatSheet(BuildContext context) {
  ContactsStore.instance.load();
  final p = context.p;
  showModalBottomSheet(
    context: context,
    builder: (c) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('New conversation', style: TextStyle(color: p.text, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          GridView.count(
            shrinkWrap: true,
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.35,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _ActionCard(Icons.chat_bubble_rounded, 'New chat', 'Message a contact', p.gradient, () {
                Navigator.pop(c);
                pickContact(context, title: 'New chat', onPick: (id) => openDirectChat(context, id));
              }),
              _ActionCard(Icons.lock_rounded, 'Secret chat', 'End-to-end encrypted', p.secureGradient, () {
                Navigator.pop(c);
                pickContact(context,
                    title: 'New secret chat', onPick: (id) => openDirectChat(context, id, secret: true));
              }),
              _ActionCard(Icons.groups_rounded, 'New group', 'Chat with many',
                  const LinearGradient(colors: [Color(0xfff97316), Color(0xffe11d48)]), () {
                Navigator.pop(c);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const NewGroupScreen()));
              }),
              _ActionCard(Icons.person_add_alt_1_rounded, 'Add contact', 'By username or phone',
                  const LinearGradient(colors: [Color(0xff2563eb), Color(0xff06b6d4)]), () {
                Navigator.pop(c);
                addContactFlow(context);
              }),
            ],
          ),
        ]),
      ),
    ),
  );
}

class _ActionCard extends StatelessWidget {
  const _ActionCard(this.icon, this.title, this.subtitle, this.gradient, this.onTap);
  final IconData icon;
  final String title, subtitle;
  final Gradient gradient;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(gradient: gradient, borderRadius: BorderRadius.circular(24)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: Colors.white, size: 28),
          const Spacer(),
          Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
          Text(subtitle, style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 12)),
        ]),
      ),
    );
  }
}

Future<void> addContactFlow(BuildContext context) async {
  final name = await promptText(context, 'Add a contact',
      hint: 'Username or phone number', ok: 'Add contact', icon: Icons.person_search_rounded);
  if (name == null || name.trim().isEmpty) return;
  try {
    await ContactsStore.instance.add(name.trim());
    if (context.mounted) toast(context, '${name.trim()} added to contacts');
  } catch (e) {
    if (context.mounted) toast(context, errText(e), error: true);
  }
}

void pickContact(BuildContext context, {required String title, required void Function(String id) onPick}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (c) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.92,
      builder: (_, scroll) => ListenableBuilder(
        listenable: ContactsStore.instance,
        builder: (_, __) {
          final p = context.p;
          final contacts = ContactsStore.instance.contacts;
          return Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Row(children: [
                Expanded(child: Text(title, style: TextStyle(color: p.text, fontSize: 20, fontWeight: FontWeight.w800))),
                IconButton.filledTonal(
                  icon: const Icon(Icons.person_add_alt_1_rounded),
                  onPressed: () => addContactFlow(context),
                ),
              ]),
            ),
            Expanded(
              child: contacts.isEmpty
                  ? EmptyState(
                      icon: Icons.people_alt_rounded,
                      title: 'No contacts yet',
                      message: 'Add someone by their username first.',
                      action: SizedBox(
                          width: 200, child: GradientButton(label: 'Add contact', onPressed: () => addContactFlow(context))),
                    )
                  : ListView.builder(
                      controller: scroll,
                      itemCount: contacts.length,
                      itemBuilder: (_, i) {
                        final id = contacts[i]['id'] as String;
                        return FadeSlideIn(
                          index: i,
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                            leading: UserAvatar(userId: id, size: 46),
                            title: Text(id, style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                            trailing: Icon(Icons.arrow_forward_ios_rounded, size: 16, color: p.subtext),
                            onTap: () {
                              Navigator.pop(c);
                              onPick(id);
                            },
                          ),
                        );
                      },
                    ),
            ),
          ]);
        },
      ),
    ),
  );
}

class NewGroupScreen extends StatefulWidget {
  const NewGroupScreen({super.key});
  @override
  State<NewGroupScreen> createState() => _NewGroupScreenState();
}

class _NewGroupScreenState extends State<NewGroupScreen> {
  final _name = TextEditingController();
  final Set<String> _selected = {};
  bool _busy = false;

  Future<void> _create() async {
    setState(() => _busy = true);
    try {
      final res = await createChat(_selected.toList(), true, _name.text.trim());
      final list = await ChatsStore.instance.load();
      final chat = list.where((c) => c['id'] == res['chat_id']).firstOrNull;
      if (!mounted) return;
      Navigator.pop(context);
      if (chat != null) openChat(context, chat);
    } catch (e) {
      if (mounted) toast(context, errText(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    final contacts = ContactsStore.instance.contacts;
    return Scaffold(
      appBar: AppBar(title: const Text('New group')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Row(children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                gradient: _name.text.isEmpty ? p.gradient : gradientFor(_name.text),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.groups_rounded, color: Colors.white, size: 32),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: TextField(
                controller: _name,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(hintText: 'Group name'),
              ),
            ),
          ]),
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 250),
          child: _selected.isEmpty
              ? const SizedBox(width: double.infinity)
              : SizedBox(
                  height: 44,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      for (final id in _selected)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: InputChip(
                            avatar: UserAvatar(userId: id, size: 24),
                            label: Text(id),
                            onDeleted: () => setState(() => _selected.remove(id)),
                          ),
                        ),
                    ],
                  ),
                ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
          child: Row(children: [
            Text('ADD MEMBERS', style: TextStyle(color: p.subtext, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.1)),
            const Spacer(),
            Text('${_selected.length} selected', style: TextStyle(color: p.primary, fontWeight: FontWeight.w600)),
          ]),
        ),
        Expanded(
          child: contacts.isEmpty
              ? const EmptyState(
                  icon: Icons.people_alt_rounded, title: 'No contacts yet', message: 'Add contacts to create a group.')
              : ListView.builder(
                  itemCount: contacts.length,
                  itemBuilder: (_, i) {
                    final id = contacts[i]['id'] as String;
                    final sel = _selected.contains(id);
                    return ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                      leading: UserAvatar(userId: id, size: 46),
                      title: Text(id, style: TextStyle(color: p.text, fontWeight: FontWeight.w600)),
                      trailing: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        width: 26,
                        height: 26,
                        decoration: BoxDecoration(
                          gradient: sel ? p.gradient : null,
                          shape: BoxShape.circle,
                          border: sel ? null : Border.all(color: p.subtext, width: 1.5),
                        ),
                        child: sel ? const Icon(Icons.check_rounded, color: Colors.white, size: 18) : null,
                      ),
                      onTap: () => setState(() => sel ? _selected.remove(id) : _selected.add(id)),
                    );
                  },
                ),
        ),
        SafeArea(
          minimum: const EdgeInsets.all(16),
          child: GradientButton(
            label: _selected.isEmpty ? 'Select members' : 'Create group',
            icon: Icons.check_rounded,
            busy: _busy,
            onPressed: _selected.isEmpty ? null : _create,
          ),
        ),
      ]),
    );
  }
}
