/**
 * End-to-end encryption primitives.
 *
 * Scheme
 *   Identity      ECDH P-256 key pair, one per account.
 *   Key storage   The private key is wrapped with AES-GCM under a PBKDF2 key
 *                 derived from the account password, so the server stores a
 *                 blob it has no way to open.
 *   Per message   A fresh AES-256-GCM content key encrypts the body. That key
 *                 is then wrapped separately for every recipient using ECIES:
 *                 an ephemeral ECDH key pair agrees a secret with the
 *                 recipient's public key, HKDF turns it into a wrapping key.
 *
 * What this protects against: anyone reading the database or intercepting
 * traffic, including the server operator and the admin panel.
 *
 * What it does NOT protect against: the server hands out public keys, so a
 * malicious server could substitute its own and machine-in-the-middle a
 * conversation. Compare the safety number (see `safetyNumber`) over a trusted
 * channel to rule that out.
 */

const CURVE = "P-256";
const PBKDF2_ITERATIONS = 310000;
const HKDF_INFO = "chatters-message-key-v1";

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      "Web Crypto is unavailable. Secure chat requires a modern browser served over HTTPS."
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
 * Import a private key. `extractable` is false for the copy we cache in
 * IndexedDB: the browser will then use it for key agreement but refuses to
 * hand the bytes back to JavaScript, so script injection cannot exfiltrate it.
 */
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
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Produce the bundle that gets stored server-side for an identity.
 */
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

/**
 * Reverse of wrapIdentity. Throws if the password is wrong — AES-GCM
 * authentication fails rather than returning garbage.
 */
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

/**
 * Encrypt one message for a set of recipients.
 *
 * @param {string} plaintext
 * @param {Array<{user_id: string, public_key: string}>} recipients
 * @returns {{ciphertext: string, iv: string, keys: Array}}
 */
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
      // A fresh ephemeral pair per recipient per message.
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

/**
 * Decrypt a message addressed to us.
 *
 * @param {{content: string, cipher_iv: string, wrapped_key: string,
 *          wrap_iv: string, ephemeral_pub: string}} message
 * @param {CryptoKey} privateKey
 */
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

/**
 * A short digest of two public keys that both sides can read aloud to confirm
 * nobody is sitting in the middle. Sorting makes it symmetric.
 */
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
