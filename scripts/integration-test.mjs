#!/usr/bin/env node
/**
 * End-to-end integration test against a running stack.
 *
 *   BASE_URL=http://localhost:8080 ADMIN_PASSWORD=... node scripts/integration-test.mjs
 *
 * It drives the real HTTP and WebSocket API rather than mocking anything, and
 * deliberately reimplements the client side of the encryption protocol instead
 * of importing the app's module: two independent implementations agreeing is
 * much stronger evidence that the wire format is right than the same code
 * checking itself.
 *
 * Requires Node 22+ (global fetch, WebCrypto and WebSocket).
 */

const BASE = process.env.BASE_URL || "http://localhost:18081";
const ADMIN_USER = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASS) {
  console.error("ADMIN_PASSWORD must be set (see .env)");
  process.exit(2);
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------ test runner */

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}`);
    console.log(`        ${err.message}`);
    failures.push(name);
    failed++;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/* ----------------------------------------------------------------- client */

async function api(path, { method = "GET", body, token, expect } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (expect !== undefined && res.status !== expect) {
    throw new Error(
      `${method} ${path} returned ${res.status}, expected ${expect}: ${text.slice(0, 200)}`
    );
  }

  return { status: res.status, data };
}

/* ------------------------------------------- encryption (reimplemented) */

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function genIdentity() {
  return subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

async function exportPub(key) {
  return b64(await subtle.exportKey("raw", key));
}

async function importPub(s) {
  return subtle.importKey("raw", unb64(s), { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function pbkdf2Key(password, salt) {
  const base = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function wrapIdentity(keyPair, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const pkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
  const aes = await pbkdf2Key(password, salt);
  const wrapped = await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, pkcs8);

  return {
    public_key: await exportPub(keyPair.publicKey),
    encrypted_private_key: b64(wrapped),
    key_salt: b64(salt),
    key_nonce: b64(nonce),
  };
}

async function unwrapIdentity(bundle, password) {
  const aes = await pbkdf2Key(password, unb64(bundle.key_salt));
  const pkcs8 = await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(bundle.key_nonce) },
    aes,
    unb64(bundle.encrypted_private_key)
  );
  return subtle.importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
}

async function wrappingKey(privateKey, publicKey) {
  const shared = await subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: enc.encode("chatters-message-key-v1"),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptFor(plaintext, recipients) {
  const contentKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    contentKey,
    enc.encode(plaintext)
  );
  const rawKey = await subtle.exportKey("raw", contentKey);

  const keys = [];
  for (const r of recipients) {
    const ephemeral = await genIdentity();
    const wk = await wrappingKey(ephemeral.privateKey, await importPub(r.public_key));
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wk, rawKey);

    keys.push({
      user_id: r.user_id,
      wrapped_key: b64(wrapped),
      wrap_iv: b64(wrapIv),
      ephemeral_pub: await exportPub(ephemeral.publicKey),
    });
  }

  return { ciphertext: b64(ciphertext), iv: b64(iv), keys };
}

async function decryptWith(msg, privateKey) {
  const wk = await wrappingKey(privateKey, await importPub(msg.ephemeral_pub));
  const rawKey = await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(msg.wrap_iv) },
    wk,
    unb64(msg.wrapped_key)
  );
  const contentKey = await subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, [
    "decrypt",
  ]);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(msg.cipher_iv) },
    contentKey,
    unb64(msg.content)
  );
  return dec.decode(plain);
}

/* -------------------------------------------------------------- websocket */

async function openSocket(token) {
  const { data } = await api("/api/ws-ticket", { method: "POST", token, expect: 200 });
  const url = BASE.replace(/^http/, "ws") + `/api/ws?ticket=${encodeURIComponent(data.ticket)}`;

  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) {
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("socket failed to open")), { once: true });
    setTimeout(() => reject(new Error("socket open timed out")), 5000);
  });

  return {
    ws,
    ticket: data.ticket,
    send: (payload) => ws.send(JSON.stringify(payload)),
    /** Resolves with the first message matching `match`, past or future. */
    wait(match, timeout = 5000) {
      const existing = inbox.find(match);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error("timed out waiting for a matching websocket message"));
        }, timeout);
      });
    },
    close: () => ws.close(),
  };
}

/* ------------------------------------------------------------------ suite */

const PASSWORD = "Test1234!pass";
const stamp = Date.now().toString().slice(-6);
const ALICE = `alice${stamp}`;
const BOB = `bob${stamp}`;
const MALLORY = `mal${stamp}`;

let adminToken;
let aliceToken;
let bobToken;
let malloryToken;
let chatId;
let aliceKeys;
let bobKeys;

console.log(`Integration test against ${BASE}\n`);

section("Health and admin bootstrap");

await check("GET /healthz reports ok", async () => {
  const { data } = await api("/healthz", { expect: 200 });
  assertEqual(data.status, "ok", "health status");
});

await check("bootstrapped administrator can sign in", async () => {
  const { data } = await api("/login", {
    method: "POST",
    body: { username: ADMIN_USER, password: ADMIN_PASS },
    expect: 200,
  });
  assert(data.token, "no token returned");
  assertEqual(data.is_admin, true, "admin flag");
  adminToken = data.token;
});

section("Admin user management");

await check("admin can create users", async () => {
  for (const name of [ALICE, BOB, MALLORY]) {
    await api("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: name, email: `${name}@example.com`, password: PASSWORD },
      expect: 200,
    });
  }
});

await check("admin can list users and see the new accounts", async () => {
  const { data } = await api(`/api/admin/users?search=${ALICE}`, {
    token: adminToken,
    expect: 200,
  });
  assert(
    data.users.some((u) => u.id === ALICE),
    "created user missing from the listing"
  );
});

await check("admin stats are reported", async () => {
  const { data } = await api("/api/admin/stats", { token: adminToken, expect: 200 });
  assert(typeof data.users === "number" && data.users >= 4, "user count looks wrong");
});

await check("duplicate username is rejected with 409", async () => {
  await api("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: { username: ALICE, email: "other@example.com", password: PASSWORD },
    expect: 409,
  });
});

await check("weak password is rejected when creating a user", async () => {
  await api("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: { username: `weak${stamp}`, email: `weak${stamp}@example.com`, password: "short" },
    expect: 400,
  });
});

await check("username with path characters is rejected", async () => {
  await api("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: { username: "../../etc", email: `trav${stamp}@example.com`, password: PASSWORD },
    expect: 400,
  });
});

await check("admin cannot delete their own account", async () => {
  await api(`/api/admin/users/${ADMIN_USER}`, {
    method: "DELETE",
    token: adminToken,
    expect: 400,
  });
});

await check("the last administrator cannot be demoted", async () => {
  await api(`/api/admin/users/${ADMIN_USER}/role`, {
    method: "PUT",
    token: adminToken,
    body: { is_admin: false },
    expect: 400,
  });
});

section("Authentication and authorisation");

await check("users can sign in and receive key material", async () => {
  for (const [name, setToken] of [
    [ALICE, (t) => (aliceToken = t)],
    [BOB, (t) => (bobToken = t)],
    [MALLORY, (t) => (malloryToken = t)],
  ]) {
    const { data } = await api("/login", {
      method: "POST",
      body: { username: name, password: PASSWORD },
      expect: 200,
    });
    assertEqual(data.is_admin, false, `${name} should not be an admin`);
    // Admin-created accounts have no keys yet.
    assertEqual(data.needs_key_setup, true, `${name} should need key setup`);
    setToken(data.token);
  }
});

await check("wrong password is rejected", async () => {
  await api("/login", {
    method: "POST",
    body: { username: ALICE, password: "not-the-password" },
    expect: 401,
  });
});

await check("a non-admin is refused the admin API", async () => {
  await api("/api/admin/users", { token: aliceToken, expect: 403 });
  await api("/api/admin/stats", { token: aliceToken, expect: 403 });
  await api(`/api/admin/users/${BOB}`, { method: "DELETE", token: aliceToken, expect: 403 });
});

await check("an unauthenticated request is refused", async () => {
  await api("/api/chats", { expect: 401 });
  await api("/api/me", { token: "garbage.token.here", expect: 401 });
});

section("End-to-end encryption key exchange");

await check("users publish their public keys", async () => {
  aliceKeys = await genIdentity();
  bobKeys = await genIdentity();

  await api("/api/keys", {
    method: "POST",
    token: aliceToken,
    body: await wrapIdentity(aliceKeys, PASSWORD),
    expect: 200,
  });
  await api("/api/keys", {
    method: "POST",
    token: bobToken,
    body: await wrapIdentity(bobKeys, PASSWORD),
    expect: 200,
  });
});

await check("a wrapped private key round-trips through the server", async () => {
  const { data } = await api("/api/keys/me", { token: aliceToken, expect: 200 });
  assertEqual(data.needs_key_setup, false, "key setup should be complete");

  // The server stored an opaque blob; only the password opens it.
  const restored = await unwrapIdentity(data.keys, PASSWORD);
  assert(restored, "failed to unwrap the stored private key");

  await unwrapIdentity(data.keys, "wrong-password").then(
    () => {
      throw new Error("the wrong password unwrapped the key");
    },
    () => {}
  );
});

section("Chat access control");

await check("a chat can be created", async () => {
  const { data } = await api("/api/chats", {
    method: "POST",
    token: aliceToken,
    body: { members: [BOB], is_group: false },
    expect: 200,
  });
  chatId = data.chat_id;
  assert(chatId, "no chat id returned");
});

await check("creating a chat with an unknown user fails cleanly", async () => {
  await api("/api/chats", {
    method: "POST",
    token: aliceToken,
    body: { members: ["definitely-not-a-user"], is_group: false },
    expect: 400,
  });
});

await check("an outsider cannot read the conversation", async () => {
  await api(`/api/chats/${chatId}/messages`, { token: malloryToken, expect: 403 });
  await api(`/api/chats/${chatId}/members`, { token: malloryToken, expect: 403 });
  await api(`/api/chats/${chatId}/keys`, { token: malloryToken, expect: 403 });
});

// This was the most serious hole found: AddMember performed no authorisation
// at all, so any authenticated user could add themselves (or anyone else) to
// any conversation just by knowing its id.
await check("an outsider cannot add themselves to someone else's chat", async () => {
  await api(`/api/chats/${chatId}/members`, {
    method: "POST",
    token: malloryToken,
    body: { user_id: MALLORY },
    expect: 403,
  });

  const { data } = await api(`/api/chats/${chatId}/members`, {
    token: aliceToken,
    expect: 200,
  });
  assert(!data.members.includes(MALLORY), "outsider actually got added");
});

await check("members cannot be added to a direct chat", async () => {
  await api(`/api/chats/${chatId}/members`, {
    method: "POST",
    token: aliceToken,
    body: { user_id: MALLORY },
    expect: 400,
  });
});

section("Realtime messaging");

let aliceSock;
let bobSock;

await check("websocket accepts a valid ticket", async () => {
  aliceSock = await openSocket(aliceToken);
  bobSock = await openSocket(bobToken);
});

await check("a ticket cannot be replayed", async () => {
  const { data } = await api("/api/ws-ticket", {
    method: "POST",
    token: aliceToken,
    expect: 200,
  });

  const url = BASE.replace(/^http/, "ws") + `/api/ws?ticket=${data.ticket}`;
  const first = new WebSocket(url);
  await new Promise((r) => first.addEventListener("open", r, { once: true }));
  first.close();

  // Same ticket a second time must be refused.
  const second = new WebSocket(url);
  const rejected = await new Promise((resolve) => {
    second.addEventListener("open", () => resolve(false), { once: true });
    second.addEventListener("error", () => resolve(true), { once: true });
    second.addEventListener("close", () => resolve(true), { once: true });
  });
  assert(rejected, "a used ticket was accepted a second time");
});

await check("websocket refuses a bogus ticket", async () => {
  const url = BASE.replace(/^http/, "ws") + "/api/ws?ticket=not-a-real-ticket";
  const ws = new WebSocket(url);
  const rejected = await new Promise((resolve) => {
    ws.addEventListener("open", () => resolve(false), { once: true });
    ws.addEventListener("error", () => resolve(true), { once: true });
    ws.addEventListener("close", () => resolve(true), { once: true });
  });
  assert(rejected, "a bogus ticket was accepted");
});

await check("a plaintext message is delivered to the other member", async () => {
  const body = `hello from alice ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });

  const received = await bobSock.wait((m) => m.type === "message" && m.content === body);
  assertEqual(received.from, ALICE, "sender");
  assertEqual(received.is_encrypted || false, false, "should not be marked encrypted");
});

await check("the heartbeat is answered", async () => {
  aliceSock.send({ type: "ping" });
  const pong = await aliceSock.wait((m) => m.type === "pong", 3000);
  assert(pong, "no pong received");
});

// Opening a second connection must not disconnect the first. The old hub kept
// one client per user, so a reconnect evicted the live socket — the direct
// cause of "I have to restart the app to receive messages".
await check("a second connection does not kill the first", async () => {
  const aliceSecond = await openSocket(aliceToken);

  const body = `two-device test ${stamp}`;
  bobSock.send({ chat_id: chatId, content: body });

  // Both of Alice's sockets should receive it.
  const onFirst = await aliceSock.wait((m) => m.type === "message" && m.content === body);
  const onSecond = await aliceSecond.wait((m) => m.type === "message" && m.content === body);

  assert(onFirst && onSecond, "message did not reach both connections");
  aliceSecond.close();
});

await check("a stale connection closing does not deafen the live one", async () => {
  // Simulate the app-switch sequence: a socket dies, a new one is opened, and
  // only then does the old one finish tearing down.
  const stale = await openSocket(aliceToken);
  const fresh = await openSocket(aliceToken);

  stale.close();
  await new Promise((r) => setTimeout(r, 500));

  const body = `after stale close ${stamp}`;
  bobSock.send({ chat_id: chatId, content: body });

  const got = await fresh.wait((m) => m.type === "message" && m.content === body, 5000);
  assert(got, "the surviving connection stopped receiving messages");
  fresh.close();
});

await check("a non-member cannot post into the chat over the socket", async () => {
  const malSock = await openSocket(malloryToken);
  const body = `intrusion ${stamp}`;
  malSock.send({ chat_id: chatId, content: body });

  await new Promise((r) => setTimeout(r, 800));

  const { data } = await api(`/api/chats/${chatId}/messages`, {
    token: aliceToken,
    expect: 200,
  });
  assert(
    !data.some((m) => m.content === body),
    "a non-member managed to write into the chat"
  );
  malSock.close();
});

section("End-to-end encrypted conversation");

await check("encryption can be switched on for a chat", async () => {
  const { data } = await api(`/api/chats/${chatId}/e2e`, {
    method: "PUT",
    token: aliceToken,
    body: { enabled: true },
    expect: 200,
  });
  assertEqual(data.e2e_enabled, true, "e2e flag");
});

await check("encryption cannot be switched back off", async () => {
  await api(`/api/chats/${chatId}/e2e`, {
    method: "PUT",
    token: aliceToken,
    body: { enabled: false },
    expect: 400,
  });
});

await check("member public keys are published to members only", async () => {
  const { data } = await api(`/api/chats/${chatId}/keys`, { token: aliceToken, expect: 200 });
  assertEqual(data.members.length, 2, "member key count");
  assertEqual(data.without_keys.length, 0, "everyone should have a key");
});

let secretText;

await check("an encrypted message round-trips between members", async () => {
  const { data } = await api(`/api/chats/${chatId}/keys`, { token: aliceToken, expect: 200 });
  secretText = `top secret ${stamp} — سلام`;

  const { ciphertext, iv, keys } = await encryptFor(secretText, data.members);
  aliceSock.send({
    chat_id: chatId,
    content: ciphertext,
    is_encrypted: true,
    cipher_iv: iv,
    keys,
  });

  const received = await bobSock.wait((m) => m.type === "message" && m.is_encrypted);
  assert(received.content !== secretText, "ciphertext equals plaintext");

  const plain = await decryptWith(received, bobKeys.privateKey);
  assertEqual(plain, secretText, "decrypted text");
});

await check("the server stores ciphertext, not plaintext", async () => {
  const { data } = await api(`/api/chats/${chatId}/messages`, {
    token: aliceToken,
    expect: 200,
  });

  const encrypted = data.filter((m) => m.is_encrypted);
  assert(encrypted.length > 0, "no encrypted message was persisted");

  for (const m of encrypted) {
    assert(m.content !== secretText, "plaintext was stored on the server");
    assert(m.cipher_iv, "missing iv");
    assert(m.wrapped_key, "missing wrapped key for the requesting member");
  }
});

await check("a cleartext message is refused in an encrypted chat", async () => {
  const body = `downgrade attempt ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });

  await new Promise((r) => setTimeout(r, 800));

  const { data } = await api(`/api/chats/${chatId}/messages`, {
    token: aliceToken,
    expect: 200,
  });
  assert(
    !data.some((m) => m.content === body),
    "a downgrade to cleartext was accepted"
  );
});

await check("an outsider gets no key material even if they see the chat id", async () => {
  await api(`/api/chats/${chatId}/messages`, { token: malloryToken, expect: 403 });
});

section("Session invalidation");

await check("an admin password reset revokes existing sessions", async () => {
  // Bob's token works right now.
  await api("/api/me", { token: bobToken, expect: 200 });

  await api(`/api/admin/users/${BOB}/password`, {
    method: "PUT",
    token: adminToken,
    body: { new_password: "BrandNew1234!" },
    expect: 200,
  });

  // And is dead immediately afterwards, rather than lingering until the JWT
  // expires 72 hours later.
  await api("/api/me", { token: bobToken, expect: 401 });
});

await check("the user can sign in again with the new password", async () => {
  const { data } = await api("/login", {
    method: "POST",
    body: { username: BOB, password: "BrandNew1234!" },
    expect: 200,
  });
  assert(data.token, "no token issued");
  // The reset cleared their keys, so a fresh identity is required.
  assertEqual(data.needs_key_setup, true, "keys should have been cleared by the reset");
});

await check("deleting a user revokes their access", async () => {
  await api(`/api/admin/users/${MALLORY}`, {
    method: "DELETE",
    token: adminToken,
    expect: 200,
  });
  await api("/api/me", { token: malloryToken, expect: 401 });
});

section("Input validation and rate limiting");

await check("registration rejects a weak password", async () => {
  await api("/register", {
    method: "POST",
    body: { username: `w${stamp}`, email: `w${stamp}@example.com`, password: "1234" },
    expect: 400,
  });
});

await check("registration rejects a malformed email", async () => {
  await api("/register", {
    method: "POST",
    body: { username: `e${stamp}`, email: "not-an-email", password: PASSWORD },
    expect: 400,
  });
});

// Runs last: it deliberately exhausts the per-IP budget for /login.
await check("repeated failed logins are rate limited", async () => {
  let sawLimit = false;

  for (let i = 0; i < 25; i++) {
    const { status } = await api("/login", {
      method: "POST",
      body: { username: ALICE, password: `wrong-${i}` },
    });
    if (status === 429) {
      sawLimit = true;
      break;
    }
  }

  assert(sawLimit, "brute-force attempts were never rate limited");
});

/* ----------------------------------------------------------------- report */

aliceSock?.close();
bobSock?.close();

console.log(`\n${"─".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed:");
  failures.forEach((f) => console.log(`  - ${f}`));
}
console.log("");

process.exit(failed > 0 ? 1 : 0);
