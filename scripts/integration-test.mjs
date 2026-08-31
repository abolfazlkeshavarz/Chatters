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

async function apiUpload(path, { token, expect, fields = {}, file } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append("file", new Blob([file.data], { type: file.type }), file.name);

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, { method: "POST", headers, body: form });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (expect !== undefined && res.status !== expect) {
    throw new Error(`POST ${path} returned ${res.status}, expected ${expect}: ${text.slice(0, 200)}`);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

section("Contacts");

await check("a contact can be added and appears in the list", async () => {
  await api("/api/contacts", { method: "POST", token: aliceToken, body: { username: BOB }, expect: 200 });

  const { data } = await api("/api/contacts", { token: aliceToken, expect: 200 });
  assert(data.contacts.some((c) => c.id === BOB), "bob should be in alice's contacts");
});

await check("contacts are one-directional", async () => {
  // Alice added Bob; that must not make Bob see Alice as a contact.
  const { data } = await api("/api/contacts", { token: bobToken, expect: 200 });
  assert(!data.contacts.some((c) => c.id === ALICE), "bob should not automatically have alice as a contact");
});

await check("adding the same contact twice is refused", async () => {
  await api("/api/contacts", { method: "POST", token: aliceToken, body: { username: BOB }, expect: 409 });
});

await check("adding yourself is refused", async () => {
  await api("/api/contacts", { method: "POST", token: aliceToken, body: { username: ALICE }, expect: 400 });
});

await check("adding a nonexistent user is refused", async () => {
  await api("/api/contacts", {
    method: "POST",
    token: aliceToken,
    body: { username: `nobody_${stamp}` },
    expect: 404,
  });
});

await check("a contact can be removed", async () => {
  await api(`/api/contacts/${BOB}`, { method: "DELETE", token: aliceToken, expect: 200 });

  const { data } = await api("/api/contacts", { token: aliceToken, expect: 200 });
  assert(!data.contacts.some((c) => c.id === BOB), "bob should be gone after removal");

  // Removing again: nothing left to remove.
  await api(`/api/contacts/${BOB}`, { method: "DELETE", token: aliceToken, expect: 404 });
});

await check("contacts require authentication", async () => {
  await api("/api/contacts", { expect: 401 });
});

section("Profile photos");

// A tiny valid PNG (1x1, transparent) - real image bytes, not a text fixture
// pretending to be one, so an eventual server-side content sniff would still
// pass.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

await check("uploading a non-image is rejected", async () => {
  await apiUpload("/api/profile/avatar", {
    token: aliceToken,
    file: { data: Buffer.from("not an image"), type: "text/plain", name: "evil.txt" },
    expect: 415,
  });
});

await check("uploading an oversized file is rejected", async () => {
  await apiUpload("/api/profile/avatar", {
    token: aliceToken,
    file: { data: Buffer.alloc(6 * 1024 * 1024), type: "image/png", name: "huge.png" },
    expect: 413,
  });
});

await check("a valid image can be uploaded", async () => {
  await apiUpload("/api/profile/avatar", {
    token: aliceToken,
    file: { data: PNG_1PX, type: "image/png", name: "me.png" },
    expect: 200,
  });

  const { data } = await api("/api/me", { token: aliceToken, expect: 200 });
  assertEqual(data.has_avatar, true, "has_avatar after upload");
  assertEqual(data.avatar_visibility, "public", "default visibility");
});

await check("the owner can always fetch their own avatar", async () => {
  const res = await fetch(`${BASE}/api/avatars/${ALICE}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assertEqual(res.status, 200, "owner fetching their own avatar");
  assertEqual(res.headers.get("content-type"), "image/png", "content type");
});

await check("a public avatar is visible to anyone signed in", async () => {
  const res = await fetch(`${BASE}/api/avatars/${ALICE}`, { headers: { Authorization: `Bearer ${bobToken}` } });
  assertEqual(res.status, 200, "public avatar visible to a non-contact");
});

await check("switching to contacts-only hides it from a non-contact", async () => {
  await api("/api/profile/avatar-visibility", {
    method: "PUT",
    token: aliceToken,
    body: { visibility: "contacts" },
    expect: 200,
  });

  // Bob is not (any longer) one of Alice's contacts, from the earlier section.
  const res = await fetch(`${BASE}/api/avatars/${ALICE}`, { headers: { Authorization: `Bearer ${bobToken}` } });
  assertEqual(res.status, 404, "contacts-only avatar hidden from a non-contact");

  // The owner can still always see their own.
  const own = await fetch(`${BASE}/api/avatars/${ALICE}`, { headers: { Authorization: `Bearer ${aliceToken}` } });
  assertEqual(own.status, 200, "owner still sees their own contacts-only avatar");
});

await check("adding the contact back makes it visible again", async () => {
  await api("/api/contacts", { method: "POST", token: bobToken, body: { username: ALICE }, expect: 200 });

  const res = await fetch(`${BASE}/api/avatars/${ALICE}`, { headers: { Authorization: `Bearer ${bobToken}` } });
  assertEqual(res.status, 200, "visible once bob has alice as a contact (either direction counts)");

  await api(`/api/contacts/${ALICE}`, { method: "DELETE", token: bobToken, expect: 200 });
});

await check("an invalid visibility value is rejected", async () => {
  await api("/api/profile/avatar-visibility", {
    method: "PUT",
    token: aliceToken,
    body: { visibility: "friends" },
    expect: 400,
  });
});

await check("deleting the avatar removes it", async () => {
  await api("/api/profile/avatar", { method: "DELETE", token: aliceToken, expect: 200 });

  const { data } = await api("/api/me", { token: aliceToken, expect: 200 });
  assertEqual(data.has_avatar, false, "has_avatar after deletion");

  const res = await fetch(`${BASE}/api/avatars/${ALICE}`, { headers: { Authorization: `Bearer ${aliceToken}` } });
  assertEqual(res.status, 404, "no avatar left to serve");
});

await check("a user with no avatar returns 404, not a crash", async () => {
  const res = await fetch(`${BASE}/api/avatars/${BOB}`, { headers: { Authorization: `Bearer ${aliceToken}` } });
  assertEqual(res.status, 404, "bob has never uploaded one");
});

await check("avatar endpoints require authentication", async () => {
  await api("/api/profile/avatar-visibility", {
    method: "PUT",
    body: { visibility: "public" },
    expect: 401,
  });
  const res = await fetch(`${BASE}/api/avatars/${ALICE}`);
  assertEqual(res.status, 401, "unauthenticated avatar fetch");
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

// Regression test for a bug found while building avatar uploads: an
// oversized multipart body trips http.MaxBytesReader mid-parse, so
// c.FormFile() itself fails - which the handler was reporting as a generic
// 400 "file required" instead of the 413 a client could actually act on.
await check("an oversized attachment is rejected with 413, not 400", async () => {
  await apiUpload(`/api/media`, {
    token: aliceToken,
    fields: { chat_id: chatId },
    file: { data: Buffer.alloc(25 * 1024 * 1024), type: "image/png", name: "huge.png" },
    expect: 413,
  });
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

section("Unread counts");

// Regression test for a cartesian-product bug: the chat list query joined both
// chat_members and messages, so every message was counted once per member.
// A two-person chat reported double, a three-person group triple.
await check("unread count is not multiplied by the member count", async () => {
  const carol = `carol${stamp}`;
  await api("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: { username: carol, email: `${carol}@example.com`, password: "CarolPass1!x" },
    expect: 200,
  });

  // A group of three, so a per-member multiplier would be a factor of 3 and
  // could not be confused with the two-member case.
  const { data: group } = await api("/api/chats", {
    method: "POST",
    token: aliceToken,
    body: { members: [BOB, carol], is_group: true, name: `counts ${stamp}` },
    expect: 200,
  });

  const sock = await openSocket(aliceToken);
  const bodies = [`count probe 1 ${stamp}`, `count probe 2 ${stamp}`];
  for (const body of bodies) {
    sock.send({ chat_id: group.chat_id, content: body });
    await sock.wait((m) => m.type === "message" && m.content === body);
  }
  sock.close();

  const { data: chats } = await api("/api/chats", { token: bobToken, expect: 200 });
  const row = chats.find((c) => c.id === group.chat_id);
  assert(row, "the new group is missing from the chat list");

  assertEqual(row.members.length, 3, "group member count");
  assertEqual(
    row.unread_count,
    bodies.length,
    `unread count for ${bodies.length} messages in a ${row.members.length}-member group`
  );
});

section("Delivery state: sent -> delivered -> seen");

// The three states drive the bubble colour (white / blue / green), so each
// transition is checked against the API rather than the UI.

async function statusOf(id) {
  const { data } = await api(`/api/chats/${chatId}/messages`, {
    token: aliceToken,
    expect: 200,
  });
  return (data.find((m) => m.id === id) || {}).status;
}

await check("a message to an offline recipient stays 'sent'", async () => {
  bobSock.close();
  await sleep(300); // let the hub observe the disconnect

  const body = `offline delivery probe ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });

  const echoed = await aliceSock.wait((m) => m.type === "message" && m.content === body);
  assertEqual(echoed.status, "sent", "status while the recipient is offline");
});

await check("coming online promotes it to 'delivered', not 'seen'", async () => {
  const body = `delivery promotion probe ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });
  const echoed = await aliceSock.wait((m) => m.type === "message" && m.content === body);
  assertEqual(echoed.status, "sent", "should start out merely sent");

  // Bob reconnects but never opens the chat.
  bobSock = await openSocket(bobToken);

  const update = await aliceSock.wait(
    (m) => m.type === "status" && (m.message_ids || []).includes(echoed.id)
  );
  assertEqual(update.status, "delivered", "status after the recipient connects");

  // The crucial distinction: connected is not the same as read.
  assertEqual(await statusOf(echoed.id), "delivered", "persisted status");
});

await check("a message sent to an already-online recipient is 'delivered'", async () => {
  const body = `online delivery probe ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });

  const echoed = await aliceSock.wait((m) => m.type === "message" && m.content === body);
  assertEqual(echoed.status, "delivered", "status with the recipient connected");
});

await check("opening the chat promotes it to 'seen'", async () => {
  const body = `read receipt probe ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });
  const echoed = await aliceSock.wait((m) => m.type === "message" && m.content === body);

  // Bob opens the conversation.
  bobSock.send({ type: "seen", chat_id: chatId });

  const update = await aliceSock.wait(
    (m) =>
      m.type === "status" &&
      m.status === "seen" &&
      (m.message_ids || []).includes(echoed.id)
  );
  assert(update, "no read receipt arrived");
  assertEqual(await statusOf(echoed.id), "seen", "persisted status");
});

await check("delivery state never moves backwards", async () => {
  const body = `monotonic probe ${stamp}`;
  aliceSock.send({ chat_id: chatId, content: body });
  const echoed = await aliceSock.wait((m) => m.type === "message" && m.content === body);

  bobSock.send({ type: "seen", chat_id: chatId });
  await aliceSock.wait(
    (m) => m.type === "status" && m.status === "seen" && (m.message_ids || []).includes(echoed.id)
  );

  // Reconnecting runs the delivery sweep again; an already-read message must
  // not be dragged back to 'delivered'.
  bobSock.close();
  await sleep(300);
  bobSock = await openSocket(bobToken);
  await sleep(600);

  assertEqual(await statusOf(echoed.id), "seen", "status after a reconnect sweep");
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

// Encryption is a consent handshake, not a unilateral switch: one side
// requests it, and only the OTHER side can accept or reject. This used to be
// a single PUT that either member could flip on alone.

await check("a member cannot accept or reject with no pending request", async () => {
  await api(`/api/chats/${chatId}/e2e/accept`, { method: "POST", token: bobToken, expect: 409 });
  await api(`/api/chats/${chatId}/e2e/reject`, { method: "POST", token: bobToken, expect: 409 });
});

await check("requesting notifies the other member over the socket", async () => {
  const { data } = await api(`/api/chats/${chatId}/e2e/request`, {
    method: "POST",
    token: aliceToken,
    expect: 200,
  });
  assertEqual(data.status, "pending", "request status");

  const seen = await bobSock.wait((m) => m.type === "e2e_request" && m.chat_id === chatId);
  assertEqual(seen.by, ALICE, "requester");
});

await check("a second request while one is pending is refused", async () => {
  await api(`/api/chats/${chatId}/e2e/request`, { method: "POST", token: aliceToken, expect: 409 });
});

await check("the requester cannot accept or reject their own request", async () => {
  await api(`/api/chats/${chatId}/e2e/accept`, { method: "POST", token: aliceToken, expect: 409 });
  await api(`/api/chats/${chatId}/e2e/reject`, { method: "POST", token: aliceToken, expect: 409 });
});

await check("rejecting notifies the requester and resets the chat", async () => {
  await api(`/api/chats/${chatId}/e2e/reject`, { method: "POST", token: bobToken, expect: 200 });

  const seen = await aliceSock.wait((m) => m.type === "e2e_rejected" && m.chat_id === chatId);
  assertEqual(seen.by, BOB, "rejector");

  const { data } = await api("/api/chats", { token: aliceToken, expect: 200 });
  const row = data.find((c) => c.id === chatId);
  assertEqual(row.e2e_status, "none", "status after rejection");
  assertEqual(row.e2e_enabled, false, "chat must stay unencrypted after a rejection");
});

await check("a chat can be requested again after a rejection", async () => {
  const { data } = await api(`/api/chats/${chatId}/e2e/request`, {
    method: "POST",
    token: aliceToken,
    expect: 200,
  });
  assertEqual(data.status, "pending", "request status");
  await bobSock.wait((m) => m.type === "e2e_request" && m.chat_id === chatId);
});

await check("accepting turns encryption on and notifies both sides", async () => {
  const { data } = await api(`/api/chats/${chatId}/e2e/accept`, {
    method: "POST",
    token: bobToken,
    expect: 200,
  });
  assertEqual(data.e2e_enabled, true, "e2e flag");

  const seenByAlice = await aliceSock.wait((m) => m.type === "e2e_accepted" && m.chat_id === chatId);
  assertEqual(seenByAlice.by, BOB, "acceptor");

  const { data: chats } = await api("/api/chats", { token: bobToken, expect: 200 });
  const row = chats.find((c) => c.id === chatId);
  assertEqual(row.e2e_status, "accepted", "status after acceptance");
});

await check("encryption cannot be requested again once accepted", async () => {
  await api(`/api/chats/${chatId}/e2e/request`, { method: "POST", token: aliceToken, expect: 409 });
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

section("Muting a chat");

await check("a chat can be muted and unmuted", async () => {
  await api(`/api/chats/${chatId}/mute`, {
    method: "PUT",
    token: bobToken,
    body: { muted: true },
    expect: 200,
  });

  let { data } = await api("/api/chats", { token: bobToken, expect: 200 });
  assertEqual(data.find((c) => c.id === chatId).muted, true, "muted after muting");

  // Alice's own view is unaffected: muting is per-user, not per-chat.
  ({ data } = await api("/api/chats", { token: aliceToken, expect: 200 }));
  assertEqual(data.find((c) => c.id === chatId).muted, false, "the other member must not see it as muted");

  await api(`/api/chats/${chatId}/mute`, {
    method: "PUT",
    token: bobToken,
    body: { muted: false },
    expect: 200,
  });

  ({ data } = await api("/api/chats", { token: bobToken, expect: 200 }));
  assertEqual(data.find((c) => c.id === chatId).muted, false, "muted after unmuting");
});

section("Admin: E2E retention and purge");

await check("retention defaults to never (0)", async () => {
  const { data } = await api("/api/admin/settings/e2e-retention", { token: adminToken, expect: 200 });
  assertEqual(data.retention_seconds, 0, "default retention");
});

await check("retention can be changed and rejects an out-of-range value", async () => {
  await api("/api/admin/settings/e2e-retention", {
    method: "PUT",
    token: adminToken,
    body: { retention_seconds: 3600 },
    expect: 200,
  });

  const { data } = await api("/api/admin/settings/e2e-retention", { token: adminToken, expect: 200 });
  assertEqual(data.retention_seconds, 3600, "retention after update");

  await api("/api/admin/settings/e2e-retention", {
    method: "PUT",
    token: adminToken,
    body: { retention_seconds: -1 },
    expect: 400,
  });

  // Restore the default so it does not affect any later test run's chats.
  await api("/api/admin/settings/e2e-retention", {
    method: "PUT",
    token: adminToken,
    body: { retention_seconds: 0 },
    expect: 200,
  });
});

await check("purge-now deletes encrypted messages but keeps the chat encrypted", async () => {
  const { data: before } = await api(`/api/chats/${chatId}/messages`, { token: aliceToken, expect: 200 });
  const encryptedBefore = before.filter((m) => m.is_encrypted).length;
  assert(encryptedBefore > 0, "test setup: there should be encrypted messages to purge");

  const { data: purge } = await api("/api/admin/e2e/purge-now", {
    method: "POST",
    token: adminToken,
    expect: 200,
  });
  assert(purge.deleted >= encryptedBefore, "reported deletion count looks too low");

  const { data: after } = await api(`/api/chats/${chatId}/messages`, { token: aliceToken, expect: 200 });
  assertEqual(after.filter((m) => m.is_encrypted).length, 0, "encrypted messages should be gone");

  // The chat's encrypted status itself is untouched — only content is cleared.
  const { data: chats } = await api("/api/chats", { token: aliceToken, expect: 200 });
  assertEqual(chats.find((c) => c.id === chatId).e2e_enabled, true, "chat must remain encrypted after a purge");
});

await check("non-admins cannot read or change retention, or trigger a purge", async () => {
  await api("/api/admin/settings/e2e-retention", { token: aliceToken, expect: 403 });
  await api("/api/admin/settings/e2e-retention", {
    method: "PUT",
    token: aliceToken,
    body: { retention_seconds: 1 },
    expect: 403,
  });
  await api("/api/admin/e2e/purge-now", { method: "POST", token: aliceToken, expect: 403 });
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
