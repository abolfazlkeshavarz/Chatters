/// End-to-end encryption primitives, wire-compatible with the web app's
/// crypto/e2ee.js (WebCrypto) so one account works on every client.
///
/// Scheme
///   Identity      ECDH P-256 key pair, one per account.
///   Key storage   The PKCS8 private key is wrapped with AES-GCM under a
///                 PBKDF2-SHA256 (310000 iterations) key from the password.
///   Per message   A fresh AES-256-GCM content key encrypts the body; that key
///                 is wrapped for each recipient with ECIES (ephemeral ECDH +
///                 HKDF-SHA256, info "chatters-message-key-v1").
library;

import 'dart:convert';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:pointycastle/export.dart';

const int pbkdf2Iterations = 310000;
const String _hkdfInfo = 'chatters-message-key-v1';

final ECDomainParameters _curve = ECCurve_secp256r1();

/* ---------------------------------------------------------------- random */

final SecureRandom _rng = () {
  final seed = Random.secure();
  final r = FortunaRandom();
  r.seed(KeyParameter(Uint8List.fromList(List.generate(32, (_) => seed.nextInt(256)))));
  return r;
}();

Uint8List randomBytes(int n) => _rng.nextBytes(n);

/* ----------------------------------------------------------------- bigint */

Uint8List _bigToBytes(BigInt v, int len) {
  final out = Uint8List(len);
  var x = v;
  for (var i = len - 1; i >= 0; i--) {
    out[i] = (x & BigInt.from(0xff)).toInt();
    x = x >> 8;
  }
  return out;
}

BigInt _bytesToBig(List<int> b) {
  var r = BigInt.zero;
  for (final byte in b) {
    r = (r << 8) | BigInt.from(byte);
  }
  return r;
}

/* -------------------------------------------------------------- identity */

class Identity {
  Identity(this.privateKey, this.publicKey);
  final ECPrivateKey privateKey;
  final ECPublicKey publicKey;

  String get publicKeyB64 => exportPublicKey(publicKey);
}

Identity generateIdentity() {
  final gen = ECKeyGenerator()
    ..init(ParametersWithRandom(ECKeyGeneratorParameters(_curve), _rng));
  final pair = gen.generateKeyPair();
  return Identity(pair.privateKey as ECPrivateKey, pair.publicKey as ECPublicKey);
}

/// Uncompressed SEC1 point (0x04 || X || Y), same as WebCrypto "raw".
String exportPublicKey(ECPublicKey key) => base64Encode(key.Q!.getEncoded(false));

ECPublicKey importPublicKey(String b64) =>
    ECPublicKey(_curve.curve.decodePoint(base64Decode(b64)), _curve);

ECPublicKey publicFromPrivate(ECPrivateKey k) => ECPublicKey(_curve.G * k.d, _curve);

/* ------------------------------------------------------------------ PKCS8 */

const _ecOid = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const _p256Oid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];

Uint8List _der(int tag, List<int> body) {
  final len = body.length;
  final lenBytes = len < 0x80
      ? [len]
      : len < 0x100
          ? [0x81, len]
          : [0x82, len >> 8, len & 0xff];
  return Uint8List.fromList([tag, ...lenBytes, ...body]);
}

/// PKCS8 PrivateKeyInfo, the same layout WebCrypto exports for P-256.
Uint8List exportPkcs8(ECPrivateKey key) {
  final pub = (_curve.G * key.d)!.getEncoded(false);
  final ecPrivate = _der(0x30, [
    0x02, 0x01, 0x01,
    ..._der(0x04, _bigToBytes(key.d!, 32)),
    ..._der(0xa1, _der(0x03, [0x00, ...pub])),
  ]);
  return _der(0x30, [
    0x02, 0x01, 0x00,
    ..._der(0x30, [..._ecOid, ..._p256Oid]),
    ..._der(0x04, ecPrivate),
  ]);
}

class _Tlv {
  _Tlv(this.tag, this.body);
  final int tag;
  final Uint8List body;
}

List<_Tlv> _parse(Uint8List data) {
  final out = <_Tlv>[];
  var i = 0;
  while (i < data.length) {
    final tag = data[i++];
    var len = data[i++];
    if (len & 0x80 != 0) {
      final n = len & 0x7f;
      len = 0;
      for (var j = 0; j < n; j++) {
        len = (len << 8) | data[i++];
      }
    }
    out.add(_Tlv(tag, Uint8List.sublistView(data, i, i + len)));
    i += len;
  }
  return out;
}

ECPrivateKey importPkcs8(Uint8List pkcs8) {
  final outer = _parse(_parse(pkcs8).single.body);
  final octet = outer.firstWhere((t) => t.tag == 0x04);
  final ecPrivate = _parse(_parse(octet.body).single.body);
  final d = ecPrivate.firstWhere((t) => t.tag == 0x04).body;
  return ECPrivateKey(_bytesToBig(d), _curve);
}

/* ---------------------------------------------------------------- AES-GCM */

Uint8List aesGcm(bool encrypt, Uint8List key, Uint8List iv, Uint8List data) {
  final c = GCMBlockCipher(AESEngine())
    ..init(encrypt, AEADParameters(KeyParameter(key), 128, iv, Uint8List(0)));
  return c.process(data);
}

/* ------------------------------------------------ password-wrapped storage */

Uint8List _pbkdf2(Uint8List password, Uint8List salt) {
  final d = PBKDF2KeyDerivator(HMac(SHA256Digest(), 64))
    ..init(Pbkdf2Parameters(salt, pbkdf2Iterations, 32));
  return d.process(password);
}

/// PBKDF2 at 310k iterations takes a moment; keep it off the UI isolate.
Future<Uint8List> passwordKey(String password, Uint8List salt) {
  final pw = Uint8List.fromList(utf8.encode(password));
  return Isolate.run(() => _pbkdf2(pw, salt));
}

Future<Map<String, String>> wrapIdentity(Identity id, String password) async {
  final salt = randomBytes(16);
  final nonce = randomBytes(12);
  final aes = await passwordKey(password, salt);
  final wrapped = aesGcm(true, aes, nonce, exportPkcs8(id.privateKey));
  return {
    'public_key': id.publicKeyB64,
    'encrypted_private_key': base64Encode(wrapped),
    'key_salt': base64Encode(salt),
    'key_nonce': base64Encode(nonce),
  };
}

Future<Identity> unwrapIdentity(Map<String, dynamic> bundle, String password) async {
  final aes = await passwordKey(password, base64Decode(bundle['key_salt'] as String));
  Uint8List pkcs8;
  try {
    pkcs8 = aesGcm(false, aes, base64Decode(bundle['key_nonce'] as String),
        base64Decode(bundle['encrypted_private_key'] as String));
  } catch (_) {
    throw Exception('Could not unlock your encryption key with that password.');
  }
  return Identity(importPkcs8(pkcs8), importPublicKey(bundle['public_key'] as String));
}

/* ----------------------------------------------------------- key agreement */

Uint8List _deriveWrappingKey(ECPrivateKey priv, ECPublicKey pub) {
  final agreement = ECDHBasicAgreement()..init(priv);
  final shared = _bigToBytes(agreement.calculateAgreement(pub), 32);
  final hkdf = HKDFKeyDerivator(SHA256Digest())
    ..init(HkdfParameters(shared, 32, Uint8List(0), Uint8List.fromList(utf8.encode(_hkdfInfo))));
  final out = Uint8List(32);
  hkdf.deriveKey(null, 0, out, 0);
  return out;
}

/* --------------------------------------------------------------- messages */

class Recipient {
  Recipient(this.userId, this.publicKey);
  final String userId;
  final String publicKey;
}

Map<String, dynamic> encryptMessage(String plaintext, List<Recipient> recipients) {
  if (recipients.isEmpty) {
    throw Exception('No recipients with published encryption keys.');
  }
  final contentKey = randomBytes(32);
  final iv = randomBytes(12);
  final ciphertext = aesGcm(true, contentKey, iv, Uint8List.fromList(utf8.encode(plaintext)));

  final keys = recipients.map((r) {
    final eph = generateIdentity();
    final wrappingKey = _deriveWrappingKey(eph.privateKey, importPublicKey(r.publicKey));
    final wrapIv = randomBytes(12);
    return {
      'user_id': r.userId,
      'wrapped_key': base64Encode(aesGcm(true, wrappingKey, wrapIv, contentKey)),
      'wrap_iv': base64Encode(wrapIv),
      'ephemeral_pub': eph.publicKeyB64,
    };
  }).toList();

  return {'ciphertext': base64Encode(ciphertext), 'iv': base64Encode(iv), 'keys': keys};
}

String decryptMessage(Map<String, dynamic> m, ECPrivateKey privateKey) {
  final content = m['content'] as String?;
  final cipherIv = m['cipher_iv'] as String?;
  final wrappedKey = m['wrapped_key'] as String?;
  final wrapIv = m['wrap_iv'] as String?;
  final ephemeralPub = m['ephemeral_pub'] as String?;
  if ([content, cipherIv, wrappedKey, wrapIv, ephemeralPub].any((v) => v == null || v.isEmpty)) {
    throw Exception('Message is missing encryption metadata.');
  }
  final wrappingKey = _deriveWrappingKey(privateKey, importPublicKey(ephemeralPub!));
  final contentKey = aesGcm(false, wrappingKey, base64Decode(wrapIv!), base64Decode(wrappedKey!));
  final plain = aesGcm(false, contentKey, base64Decode(cipherIv!), base64Decode(content!));
  return utf8.decode(plain);
}

/* -------------------------------------------------------- key verification */

String safetyNumber(String a, String b) {
  final sorted = [a, b]..sort();
  final digest = SHA256Digest().process(Uint8List.fromList(utf8.encode('${sorted[0]}|${sorted[1]}')));
  final digits = digest.sublist(0, 15).map((x) => x.toString().padLeft(3, '0')).join();
  final groups = <String>[];
  for (var i = 0; i < digits.length; i += 5) {
    groups.add(digits.substring(i, min(i + 5, digits.length)));
  }
  return groups.join(' ');
}
