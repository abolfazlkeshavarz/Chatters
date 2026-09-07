/**
 * Sign in / sign out, plus first-run identity-key setup. Mirrors the web app's
 * api/auth.js; the differences are all storage-layer (SecureStore instead of
 * localStorage, and the keystore persists PKCS8 bytes rather than a CryptoKey).
 */

import { api, request } from "./client";
import {
  generateIdentity,
  wrapIdentity,
  unwrapIdentity,
  exportPrivateKeyPkcs8,
  isSupported,
} from "../crypto/e2ee";
import { saveIdentity, loadIdentity, clearIdentity } from "../crypto/keystore";
import { setItem, getItem, clearSession } from "../storage";

export async function login(username, password) {
  const data = await request("/login", {
    method: "POST",
    auth: false,
    body: { username, password },
  });

  await setItem("token", data.token);
  await setItem("username", data.username || username);
  await setItem("is_admin", data.is_admin ? "1" : "0");

  await establishIdentity(
    data.username || username,
    password,
    data.keys,
    data.needs_key_setup
  );

  return data;
}

/**
 * Make sure the signed-in account has a usable identity key on this device.
 * Never blocks sign-in: plain chats must keep working even if crypto setup
 * fails.
 */
async function establishIdentity(username, password, bundle, needsSetup) {
  if (!isSupported()) {
    console.warn("encryption unavailable: crypto module not installed");
    return;
  }

  try {
    if (!needsSetup && bundle && bundle.public_key && bundle.encrypted_private_key) {
      await persist(username, await unwrapIdentity(bundle, password, { extractable: true }));
      return;
    }

    const keyPair = await generateIdentity();
    const fresh = await wrapIdentity(keyPair, password);
    await api.post("/api/keys", fresh);
    await persist(username, await unwrapIdentity(fresh, password, { extractable: true }));
  } catch (err) {
    console.warn("encryption key setup skipped:", err.message);
  }
}

async function persist(username, identity) {
  await saveIdentity({
    username,
    privateKeyPkcs8: await exportPrivateKeyPkcs8(identity.privateKey),
    publicKeyB64: identity.publicKeyB64,
  });
}

export async function register(username, email, password) {
  let keys;
  try {
    keys = await wrapIdentity(await generateIdentity(), password);
  } catch {
    keys = undefined; // account still gets created; key set up at first login
  }

  return request("/register", {
    method: "POST",
    auth: false,
    body: { username, email, password, keys },
  });
}

export async function logout() {
  await clearSession();
  await clearIdentity();
}

export function currentUser() {
  return getItem("username");
}

export function isAdmin() {
  return getItem("is_admin") === "1";
}

export function getMe() {
  return api.get("/api/me");
}

export { loadIdentity };
