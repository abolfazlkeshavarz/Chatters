import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../api/endpoints.dart';
import '../crypto/e2ee.dart';
import '../crypto/keystore.dart';
import '../storage.dart';
import 'chat_socket.dart';

/// Signed-in state for the whole app.
class Auth extends ChangeNotifier {
  Auth._() {
    Api.onSessionExpired.listen((_) => _signedOut());
  }
  static final Auth instance = Auth._();

  String? get user => Storage.username;
  bool get signedIn => Storage.token != null;
  bool isAdmin = false;

  void init() {
    isAdmin = Storage.isAdmin;
    if (signedIn) _afterSignIn();
  }

  Future<void> login(String username, String password) async {
    final data = await Api.request('/login',
        method: 'POST', auth: false, body: {'username': username, 'password': password}) as Map;
    final name = (data['username'] as String?) ?? username;
    await Storage.set('token', data['token'] as String);
    await Storage.set('username', name);
    await Storage.set('is_admin', data['is_admin'] == true ? '1' : '0');
    isAdmin = data['is_admin'] == true;

    await _establishIdentity(name, password, data['keys'] as Map<String, dynamic>?,
        data['needs_key_setup'] == true);
    _afterSignIn();
    notifyListeners();
  }

  /// Make sure the account has a usable identity key on this device. Never
  /// blocks sign-in: plain chats must keep working if crypto setup fails.
  Future<void> _establishIdentity(
      String username, String password, Map<String, dynamic>? bundle, bool needsSetup) async {
    try {
      if (!needsSetup &&
          bundle != null &&
          bundle['public_key'] != null &&
          bundle['encrypted_private_key'] != null) {
        await Keystore.save(username, await unwrapIdentity(bundle, password));
        return;
      }
      final id = generateIdentity();
      final fresh = await wrapIdentity(id, password);
      await Api.post('/api/keys', fresh);
      await Keystore.save(username, id);
    } catch (e) {
      debugPrint('encryption key setup skipped: $e');
    }
  }

  Future<Map<String, dynamic>> register(String username, String email, String password) async {
    Map<String, String>? keys;
    try {
      keys = await wrapIdentity(generateIdentity(), password);
    } catch (_) {}
    final res = await Api.request('/register', method: 'POST', auth: false, body: {
      'username': username,
      'email': email,
      'password': password,
      if (keys != null) 'keys': keys,
    });
    return (res as Map?)?.cast<String, dynamic>() ?? {};
  }

  void _afterSignIn() {
    ChatSocket.instance.start();
    refreshRole();
  }

  Future<void> refreshRole() async {
    try {
      final me = await getMe();
      isAdmin = me['is_admin'] == true;
      await Storage.set('is_admin', isAdmin ? '1' : '0');
      notifyListeners();
    } catch (_) {}
  }

  Future<void> logout() async {
    await Storage.clearSession();
    await Keystore.clear();
    _signedOut();
  }

  void _signedOut() {
    ChatSocket.instance.stop();
    isAdmin = false;
    notifyListeners();
  }
}
