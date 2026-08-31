#!/usr/bin/env node
/**
 * Proves the Redis-backed multi-instance path actually works, not just that
 * it compiles. Talks to two backend containers directly by IP (bypassing
 * nginx, whose Docker-DNS round robin cannot be aimed at a specific replica)
 * so that "alice's socket is on replica 1, bob's is on replica 2" is
 * deterministic rather than hoped-for.
 *
 * Usage: node cross-instance-test.mjs <replica1-ip> <replica2-ip>
 * Intended to run inside a container on the same Docker network — see
 * scripts/run-cross-instance-test.sh.
 */
import { WebSocket } from "ws";

const [, , HOST1, HOST2] = process.argv;
if (!HOST1 || !HOST2) {
  console.error("usage: cross-instance-test.mjs <replica1-ip> <replica2-ip>");
  process.exit(2);
}

const BASE1 = `http://${HOST1}:8080`;
const BASE2 = `http://${HOST2}:8080`;
const stamp = Date.now();
const ALICE = `xi_alice_${stamp}`;
const BOB = `xi_bob_${stamp}`;
const PASSWORD = "CrossInstance1!";

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    failed = true;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function api(base, path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${base}${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function register(base, username) {
  await api(base, "/register", {
    method: "POST",
    body: { username, email: `${username}@example.com`, password: PASSWORD },
  });
}

async function login(base, username) {
  const { token } = await api(base, "/login", { method: "POST", body: { username, password: PASSWORD } });
  return token;
}

async function openSocket(base, host, token) {
  const { ticket } = await api(base, "/api/ws-ticket", { method: "POST", token });
  const ws = new WebSocket(`ws://${host}:8080/api/ws?ticket=${encodeURIComponent(ticket)}`);
  const inbox = [];
  const waiters = [];

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) {
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    setTimeout(() => reject(new Error("socket open timed out")), 5000);
  });

  return {
    ws,
    send: (payload) => ws.send(JSON.stringify(payload)),
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
  };
}

async function main() {
  console.log(`replica 1: ${BASE1}`);
  console.log(`replica 2: ${BASE2}`);
  console.log();

  await register(BASE1, ALICE);
  await register(BASE2, BOB); // registering via the OTHER replica too: proves shared DB, not just shared cache

  const aliceToken = await login(BASE1, ALICE);
  const bobToken = await login(BASE2, BOB);

  const { chat_id: chatId } = await api(BASE1, "/api/chats", {
    method: "POST",
    token: aliceToken,
    body: { members: [BOB], is_group: false },
  });
  console.log(`chat: ${chatId}`);

  // The whole point: alice's socket lives on replica 1, bob's on replica 2.
  const alice = await openSocket(BASE1, HOST1, aliceToken);
  const bob = await openSocket(BASE2, HOST2, bobToken);
  console.log("alice connected to replica 1, bob connected to replica 2");
  console.log();

  const body = `cross-instance message ${stamp}`;
  alice.send({ chat_id: chatId, content: body });

  try {
    const received = await bob.wait((m) => m.type === "message" && m.content === body, 8000);
    assert(received.from === ALICE, "message delivered cross-instance via Redis Pub/Sub");
    assert(
      received.status === "delivered",
      `presence was shared across replicas (status was reported as delivered, not sent — got "${received.status}")`
    );
  } catch (err) {
    assert(false, `message delivered cross-instance via Redis Pub/Sub (${err.message})`);
  }

  // And the return trip, replica 2 -> replica 1, to rule out one-directional luck.
  const reply = `cross-instance reply ${stamp}`;
  bob.send({ chat_id: chatId, content: reply });
  try {
    const received = await alice.wait((m) => m.type === "message" && m.content === reply, 8000);
    assert(received.from === BOB, "reply delivered cross-instance in the other direction");
  } catch (err) {
    assert(false, `reply delivered cross-instance in the other direction (${err.message})`);
  }

  alice.ws.close();
  bob.ws.close();

  console.log();
  if (failed) {
    console.error("CROSS-INSTANCE TEST FAILED");
    process.exit(1);
  }
  console.log("CROSS-INSTANCE TEST PASSED");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
