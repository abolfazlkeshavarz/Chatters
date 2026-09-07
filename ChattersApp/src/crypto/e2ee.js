/**
 * End-to-end encryption primitives.
 *
 * This is a near-verbatim port of the web app's crypto/e2ee.js so that an
 * account's identity key and every ciphertext stay wire-compatible between the
 * browser and the mobile app: same curve (P-256), same PKCS8-wrapped private
 * key, same per-message ECIES envelope.
 *
 * The only change from the web version is the Web Crypto implementation
 * underneath: on device it is react-native-quick-crypto (native OpenSSL),
 * installed by src/polyfills.js before this module is imported.
 *
 * Scheme
 *   Identity      ECDH P-256 key pair, one per account.
 *   Key storage   The private key is wrapped with AES-GCM under a PBKDF2 key
 *                 derived from the account password.
 *   Per message   A fresh AES-256-GCM content key encrypts the body; that key
 *                 is wrapped for each recipient with ECIES (ephemeral ECDH +
 *                 HKDF).
 */

const CURVE = "P-256";
const PBKDF2_ITERATIONS = 310000;
const HKDF_INFO = "chatters-message-key-v1";

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      "Secure chat is unavailable: the crypto module failed to load. Reinstall the app."
    );
  }
  return c.subtle;
};

export function isSupported() {
  return Boolean(globalThis.crypto && globalThis.crypto.subtle);
}

/* ---------------------------------------------------------------- encoding */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBase64(bytes) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/* ------------------------------------------------------------- identity key */

export async function generateIdentity() {
  return subtle().generateKey({ name: "ECDH", namedCurve: CURVE }, true, [
    "deriveBits",
  ]);
}

export async function exportPublicKey(publicKey) {
  return toBase64(await subtle().exportKey("raw", publicKey));
}

export async function importPublicKey(b64) {
  return subtle().importKey(
    "raw",
    fromBase64(b64),
    { name: "ECDH", namedCurve: CURVE },
    true,
    []
  );
}

/**
 * Export a private key as PKCS8 bytes. On the web the cached key is
 * non-extractable and this is never called; on device we persist the bytes in
 * hardware-backed secure storage and re-import them on launch, so the key has
 * to be exportable at least once right after it is unwrapped.
 */
export async function exportPrivateKeyPkcs8(privateKey) {
  return new Uint8Array(await subtle().exportKey("pkcs8", privateKey));
}

export async function importPrivateKey(pkcs8Bytes, extractable = false) {
  return subtle().importKey(
    "pkcs8",
    pkcs8Bytes,
    { name: "ECDH", namedCurve: CURVE },
    extractable,
    ["deriveBits"]
  );
}

/* ------------------------------------------------- password-wrapped storage */

async function passwordKey(password, salt) {
  const base = await subtle().importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapIdentity(keyPair, password) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);

  const pkcs8 = await subtle().exportKey("pkcs8", keyPair.privateKey);
  const aes = await passwordKey(password, salt);

  const wrapped = await subtle().encrypt(
    { name: "AES-GCM", iv: nonce },
    aes,
    pkcs8
  );

  return {
    public_key: await exportPublicKey(keyPair.publicKey),
    encrypted_private_key: toBase64(wrapped),
    key_salt: toBase64(salt),
    key_nonce: toBase64(nonce),
  };
}

export async function unwrapIdentity(bundle, password, { extractable = false } = {}) {
  const salt = fromBase64(bundle.key_salt);
  const nonce = fromBase64(bundle.key_nonce);
  const aes = await passwordKey(password, salt);

  let pkcs8;
  try {
    pkcs8 = await subtle().decrypt(
      { name: "AES-GCM", iv: nonce },
      aes,
      fromBase64(bundle.encrypted_private_key)
    );
  } catch {
    throw new Error("Could not unlock your encryption key with that password.");
  }

  return {
    privateKey: await importPrivateKey(pkcs8, extractable),
    publicKey: await importPublicKey(bundle.public_key),
    publicKeyB64: bundle.public_key,
  };
}

/* ------------------------------------------------------------ key agreement */

async function deriveWrappingKey(privateKey, publicKey) {
  const shared = await subtle().deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );

  const hkdfKey = await subtle().importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);

  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: textEncoder.encode(HKDF_INFO),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* --------------------------------------------------------------- messages */

export async function encryptMessage(plaintext, recipients) {
  if (!recipients || recipients.length === 0) {
    throw new Error("No recipients with published encryption keys.");
  }

  const contentKey = await subtle().generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = randomBytes(12);
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv },
    contentKey,
    textEncoder.encode(plaintext)
  );

  const rawContentKey = await subtle().exportKey("raw", contentKey);

  const keys = await Promise.all(
    recipients.map(async (r) => {
      const ephemeral = await generateIdentity();
      const recipientPub = await importPublicKey(r.public_key);
      const wrappingKey = await deriveWrappingKey(
        ephemeral.privateKey,
        recipientPub
      );

      const wrapIv = randomBytes(12);
      const wrapped = await subtle().encrypt(
        { name: "AES-GCM", iv: wrapIv },
        wrappingKey,
        rawContentKey
      );

      return {
        user_id: r.user_id,
        wrapped_key: toBase64(wrapped),
        wrap_iv: toBase64(wrapIv),
        ephemeral_pub: await exportPublicKey(ephemeral.publicKey),
      };
    })
  );

  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv), keys };
}

export async function decryptMessage(message, privateKey) {
  const { content, cipher_iv, wrapped_key, wrap_iv, ephemeral_pub } = message;

  if (!content || !cipher_iv || !wrapped_key || !wrap_iv || !ephemeral_pub) {
    throw new Error("Message is missing encryption metadata.");
  }

  const ephemeralPub = await importPublicKey(ephemeral_pub);
  const wrappingKey = await deriveWrappingKey(privateKey, ephemeralPub);

  const rawContentKey = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(wrap_iv) },
    wrappingKey,
    fromBase64(wrapped_key)
  );

  const contentKey = await subtle().importKey(
    "raw",
    rawContentKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const plaintext = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(cipher_iv) },
    contentKey,
    fromBase64(content)
  );

  return textDecoder.decode(plaintext);
}

/* -------------------------------------------------------- key verification */

export async function safetyNumber(publicKeyA, publicKeyB) {
  const [a, b] = [publicKeyA, publicKeyB].sort();
  const digest = await subtle().digest(
    "SHA-256",
    textEncoder.encode(`${a}|${b}`)
  );

  const bytes = new Uint8Array(digest).slice(0, 15);
  const digits = Array.from(bytes)
    .map((byte) => byte.toString().padStart(3, "0"))
    .join("");

  return digits.match(/.{1,5}/g).join(" ");
}
