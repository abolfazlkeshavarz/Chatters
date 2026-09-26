import 'dart:convert';

import '../storage.dart';
import 'e2ee.dart';

/// Caches the unlocked identity key between launches in Keychain / Keystore
/// storage, scoped to a username so a shared device never hands one account's
/// key to another.
class Keystore {
  static const _key = 'chatters.identity.v1';

  static Future<void> save(String username, Identity id) async {
    await Storage.writeRaw(
      _key,
      jsonEncode({
        'username': username,
        'privateKeyPkcs8B64': base64Encode(exportPkcs8(id.privateKey)),
        'publicKeyB64': id.publicKeyB64,
      }),
    );
  }

  static Future<Identity?> load(String? username) async {
    if (username == null) return null;
    try {
      final raw = await Storage.readRaw(_key);
      if (raw == null) return null;
      final rec = jsonDecode(raw) as Map<String, dynamic>;
      if (rec['username'] != username) return null;
      return Identity(
        importPkcs8(base64Decode(rec['privateKeyPkcs8B64'] as String)),
        importPublicKey(rec['publicKeyB64'] as String),
      );
    } catch (_) {
      return null;
    }
  }

  static Future<void> clear() => Storage.writeRaw(_key, null);
}
