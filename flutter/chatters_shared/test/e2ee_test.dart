import 'dart:convert';
import 'dart:io';

import 'package:chatters_shared/src/crypto/e2ee.dart';
import 'package:flutter_test/flutter_test.dart';

/// The fixture was produced by the web app's frontend/src/crypto/e2ee.js
/// (WebCrypto), so these tests prove the Dart port is wire-compatible.
void main() {
  final fixture = jsonDecode(File('test/fixtures/web_e2ee_fixture.json').readAsStringSync())
      as Map<String, dynamic>;

  test('unwraps a web-wrapped identity and decrypts a web message', () async {
    final id = await unwrapIdentity(fixture['bundle'] as Map<String, dynamic>, 'correct horse');
    expect(id.publicKeyB64, fixture['bundle']['public_key']);
    expect(exportPublicKey(publicFromPrivate(id.privateKey)), fixture['bundle']['public_key']);
    expect(decryptMessage(fixture['message'] as Map<String, dynamic>, id.privateKey), 'سلام from the web 👋');
  });

  test('rejects the wrong password', () async {
    expect(() => unwrapIdentity(fixture['bundle'] as Map<String, dynamic>, 'nope'), throwsException);
  });

  test('safety number matches the web implementation', () {
    expect(safetyNumber(fixture['bundle']['public_key'] as String, fixture['pubB'] as String), fixture['safety']);
  });

  test('PKCS8 round-trips', () {
    final id = generateIdentity();
    expect(importPkcs8(exportPkcs8(id.privateKey)).d, id.privateKey.d);
  });

  test('encrypt / decrypt round-trip for several recipients', () {
    final a = generateIdentity(), b = generateIdentity();
    final enc = encryptMessage('hello', [Recipient('a', a.publicKeyB64), Recipient('b', b.publicKeyB64)]);
    for (final (i, id) in [a, b].indexed) {
      final k = (enc['keys'] as List)[i] as Map<String, dynamic>;
      final msg = {'content': enc['ciphertext'], 'cipher_iv': enc['iv'], ...k};
      expect(decryptMessage(msg, id.privateKey), 'hello');
    }
  });

  final out = Platform.environment['E2EE_DART_OUT'];
  if (out != null) {
    test('writes a Dart fixture for the web to verify', () async {
      final d = generateIdentity();
      final bundle = await wrapIdentity(d, 'battery staple');
      final enc = encryptMessage('hi from dart ✅', [Recipient('alice', fixture['bundle']['public_key'] as String)]);
      final k = (enc['keys'] as List).first as Map<String, dynamic>;
      File(out).writeAsStringSync(jsonEncode({
        'bundle': bundle,
        'message': {'content': enc['ciphertext'], 'cipher_iv': enc['iv'], ...k},
      }));
    });
  }
}
