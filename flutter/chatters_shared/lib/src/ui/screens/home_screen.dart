import 'package:flutter/material.dart';

import '../../services/auth.dart';
import 'admin_screen.dart';
import 'chat_list_screen.dart';
import 'profile_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Auth.instance,
      builder: (context, _) {
        final admin = Auth.instance.isAdmin;
        final pages = [const ChatListScreen(), const ProfileScreen(), if (admin) const AdminScreen()];
        final tab = _tab < pages.length ? _tab : 0;
        return Scaffold(
          body: IndexedStack(index: tab, children: pages),
          bottomNavigationBar: NavigationBar(
            selectedIndex: tab,
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: [
              const NavigationDestination(icon: Icon(Icons.chat_bubble_outline), label: 'Chats'),
              const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
              if (admin)
                const NavigationDestination(icon: Icon(Icons.admin_panel_settings_outlined), label: 'Admin'),
            ],
          ),
        );
      },
    );
  }
}
