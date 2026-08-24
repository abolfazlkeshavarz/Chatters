/**
 * Runs in the node environment because jsdom does not implement SubtleCrypto.
 *
 * @jest-environment node
 */

import {
  generateIdentity,
  wrapIdentity,
  unwrapIdentity,
  exportPublicKey,
  encryptMessage,
  decryptMessage,
  safetyNumber,
  isSupported,
} from "./e2ee";

// PBKDF2 at 310k iterations is deliberately slow.
jest.setTimeout(30000);

async function identityFor(userId) {
  const keys = await generateIdentity();
  return { keys, user_id: userId, public_key: await exportPublicKey(keys.publicKey) };
}

function envelope(enc, userId) {
  const k = enc.keys.find((x) => x.user_id === userId);
  return {
    content: enc.ciphertext,
    cipher_iv: enc.iv,
    wrapped_key: k.wrapped_key,
    wrap_iv: k.wrap_iv,
    ephemeral_pub: k.ephemeral_pub,
  };
}

test("Web Crypto is available in this environment", () => {
  expect(isSupported()).toBe(true);
});

describe("identity key wrapping", () => {
  test("round-trips with the correct password", async () => {
    const id = await generateIdentity();
    const bundle = await wrapIdentity(id, "correct horse battery");

    const restored = await unwrapIdentity(bundle, "correct horse battery");
    expect(restored.publicKeyB64).toBe(bundle.public_key);
  });

  test("rejects the wrong password instead of returning garbage", async () => {
    const id = await generateIdentity();
    const bundle = await wrapIdentity(id, "right-password");

    await expect(unwrapIdentity(bundle, "wrong-password")).rejects.toThrow(
      /Could not unlock/
    );
  });

  test("stores no plaintext key material in the bundle", async () => {
    const id = await generateIdentity();
    const bundle = await wrapIdentity(id, "pw-for-storage-check");

    // The server sees these four fields and nothing else.
    expect(Object.keys(bundle).sort()).toEqual([
      "encrypted_private_key",
      "key_nonce",
      "key_salt",
      "public_key",
    ]);
    // A fresh wrap of the same key must differ (random salt + nonce).
    const again = await wrapIdentity(id, "pw-for-storage-check");
    expect(again.encrypted_private_key).not.toBe(bundle.encrypted_private_key);
  });
});

describe("message encryption", () => {
  test("round-trips to a single recipient, including non-ASCII", async () => {
    const bob = await identityFor("bob");
    const plaintext = "سلام دنیا — hello world 🔐";

    const enc = await encryptMessage(plaintext, [bob]);
    const out = await decryptMessage(envelope(enc, "bob"), bob.keys.privateKey);

    expect(out).toBe(plaintext);
  });

  test("every group member can decrypt independently", async () => {
    const members = await Promise.all(
      ["a", "b", "c"].map((id) => identityFor(id))
    );

    const enc = await encryptMessage("group secret", members);
    expect(enc.keys).toHaveLength(3);

    for (const m of members) {
      const out = await decryptMessage(
        envelope(enc, m.user_id),
        m.keys.privateKey
      );
      expect(out).toBe("group secret");
    }
  });

  test("a non-recipient cannot decrypt", async () => {
    const bob = await identityFor("bob");
    const eve = await identityFor("eve");

    const enc = await encryptMessage("for bob only", [bob]);

    await expect(
      decryptMessage(envelope(enc, "bob"), eve.keys.privateKey)
    ).rejects.toThrow();
  });

  test("tampered ciphertext is rejected rather than silently mangled", async () => {
    const bob = await identityFor("bob");
    const enc = await encryptMessage("authentic", [bob]);

    const raw = Buffer.from(enc.ciphertext, "base64");
    raw[0] ^= 0xff;

    const tampered = { ...envelope(enc, "bob"), content: raw.toString("base64") };
    await expect(
      decryptMessage(tampered, bob.keys.privateKey)
    ).rejects.toThrow();
  });

  test("identical plaintext produces different ciphertext each time", async () => {
    const bob = await identityFor("bob");

    const a = await encryptMessage("same text", [bob]);
    const b = await encryptMessage("same text", [bob]);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.keys[0].ephemeral_pub).not.toBe(b.keys[0].ephemeral_pub);
  });

  test("refuses to encrypt with no recipients", async () => {
    await expect(encryptMessage("hello", [])).rejects.toThrow(/No recipients/);
  });
});

describe("safety number", () => {
  test("is symmetric regardless of argument order", async () => {
    const a = await identityFor("a");
    const b = await identityFor("b");

    const one = await safetyNumber(a.public_key, b.public_key);
    const two = await safetyNumber(b.public_key, a.public_key);

    expect(one).toBe(two);
    expect(one).toMatch(/^[\d ]+$/);
  });

  test("differs for a different peer", async () => {
    const a = await identityFor("a");
    const b = await identityFor("b");
    const c = await identityFor("c");

    const ab = await safetyNumber(a.public_key, b.public_key);
    const ac = await safetyNumber(a.public_key, c.public_key);

    expect(ab).not.toBe(ac);
  });
});
