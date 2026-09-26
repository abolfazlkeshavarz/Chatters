import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/stores.dart';
import '../theme.dart';
import '../widgets/design.dart';
import 'chat_list_screen.dart';
import 'contacts_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  static const _items = [
    (Icons.chat_bubble_outline_rounded, Icons.chat_bubble_rounded, 'Chats'),
    (Icons.people_outline_rounded, Icons.people_rounded, 'Contacts'),
    (Icons.settings_outlined, Icons.settings_rounded, 'Settings'),
  ];

  @override
  Widget build(BuildContext context) {
    final p = context.p;
    return Scaffold(
      extendBody: true,
      body: IndexedStack(
        index: _tab,
        children: const [ChatListScreen(), ContactsScreen(), SettingsScreen()],
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Glass(
          radius: 30,
          padding: const EdgeInsets.all(6),
          child: Row(children: [
            for (var i = 0; i < _items.length; i++)
              Expanded(
                child: Pressable(
                  onTap: () {
                    if (_tab != i) HapticFeedback.selectionClick();
                    setState(() => _tab = i);
                  },
                  haptic: false,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeOutCubic,
                    height: 52,
                    decoration: BoxDecoration(
                      gradient: _tab == i ? p.gradient : null,
                      borderRadius: BorderRadius.circular(24),
                      boxShadow: _tab == i
                          ? [BoxShadow(color: p.primary.withValues(alpha: 0.35), blurRadius: 16, offset: const Offset(0, 6))]
                          : null,
                    ),
                    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Stack(clipBehavior: Clip.none, children: [
                        Icon(_tab == i ? _items[i].$2 : _items[i].$1,
                            color: _tab == i ? Colors.white : p.subtext, size: 24),
                        if (i == 0) const Positioned(right: -10, top: -6, child: _UnreadDot()),
                      ]),
                      AnimatedSize(
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.easeOutCubic,
                        child: _tab == i
                            ? Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: Text(_items[i].$3,
                                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                              )
                            : const SizedBox.shrink(),
                      ),
                    ]),
                  ),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

class _UnreadDot extends StatelessWidget {
  const _UnreadDot();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ChatsStore.instance,
      builder: (context, _) {
        final n = ChatsStore.instance.unreadTotal;
        return AnimatedScale(
          scale: n > 0 ? 1 : 0,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOutBack,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            constraints: const BoxConstraints(minWidth: 18),
            decoration: BoxDecoration(
              color: context.p.danger,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: context.p.surface, width: 1.5),
            ),
            child: Text(n > 99 ? '99+' : '$n',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
          ),
        );
      },
    );
  }
}
