import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'config.dart';

/// Session values (token, username, admin flag) kept in the iOS Keychain /
/// Android Keystore-backed storage, hydrated into memory once at launch so the
/// rest of the app can read them synchronously.
class Storage {
  Storage._();

  static const _secure = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _keys = ['token', 'username', 'is_admin'];
  static final Map<String, String?> _cache = {};

  static Future<void> hydrate() async {
    for (final k in _keys) {
      try {
        _cache[k] = await _secure.read(key: k);
      } catch (_) {
        _cache[k] = null;
      }
    }
    setServerOverride(await readRaw(serverKey));
  }

  static const serverKey = 'server.url';

  static String? get(String key) => _cache[key];

  static Future<void> set(String key, String? value) async {
    _cache[key] = value;
    try {
      if (value == null) {
        await _secure.delete(key: key);
      } else {
        await _secure.write(key: key, value: value);
      }
    } catch (_) {
      // Keep the in-memory value; the user re-signs in next launch.
    }
  }

  static Future<String?> readRaw(String key) async {
    try {
      return await _secure.read(key: key);
    } catch (_) {
      return null;
    }
  }

  static Future<void> writeRaw(String key, String? value) => set(key, value);

  static String? get token => _cache['token'];
  static String? get username => _cache['username'];
  static bool get isAdmin => _cache['is_admin'] == '1';

  static Future<void> clearSession() async {
    for (final k in _keys) {
      await set(k, null);
    }
  }
}
