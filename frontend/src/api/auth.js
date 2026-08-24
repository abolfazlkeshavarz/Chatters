import { api, request } from "./client";
import { generateIdentity, wrapIdentity, unwrapIdentity } from "../crypto/e2ee";
import { saveIdentity, clearIdentity } from "../crypto/keystore";

/**
 * Sign in, then unlock (or create) the account's end-to-end encryption key.
 *
 * The password is used twice and never leaves this function: once to
 * authenticate, once to derive the key that unwraps the identity private key.
 */
export async function login(username, password) {
  const data = await request("/login", {
    method: "POST",
    auth: false,
    body: { username, password },
  });

  localStorage.setItem("token", data.token);
  localStorage.setItem("username", data.username || username);
  localStorage.setItem("is_admin", data.is_admin ? "1" : "0");

  await establishIdentity(data.username || username, password, data.keys, data.needs_key_setup);

  return data;
}

/**
 * Make sure the signed-in account has a usable identity key.
 *
 * Accounts that predate encryption — and accounts an admin created or reset —
 * arrive with no key material, so we mint a pair and publish the public half.
 */
async function establishIdentity(username, password, bundle, needsSetup) {
  try {
    if (!needsSetup && bundle && bundle.public_key && bundle.encrypted_private_key) {
      const identity = await unwrapIdentity(bundle, password);
      await saveIdentity({
        username,
        privateKey: identity.privateKey,
        publicKeyB64: identity.publicKeyB64,
      });
      return;
    }

    const keyPair = await generateIdentity();
    const fresh = await wrapIdentity(keyPair, password);
    await api.post("/api/keys", fresh);

    const identity = await unwrapIdentity(fresh, password);
    await saveIdentity({
      username,
      privateKey: identity.privateKey,
      publicKeyB64: identity.publicKeyB64,
    });
  } catch (err) {
    // Never block sign-in on encryption setup: plain chats must keep working
    // even if this browser cannot do Web Crypto (e.g. served over plain HTTP).
    console.warn("encryption key setup skipped:", err.message);
  }
}

export async function register(username, email, password) {
  let keys;
  try {
    keys = await wrapIdentity(await generateIdentity(), password);
  } catch {
    keys = undefined; // account still gets created, key set up at first login
  }

  return request("/register", {
    method: "POST",
    auth: false,
    body: { username, email, password, keys },
  });
}

export async function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  localStorage.removeItem("is_admin");
  await clearIdentity();
}

export function isLoggedIn() {
  return Boolean(localStorage.getItem("token"));
}

export function currentUser() {
  return localStorage.getItem("username");
}

export function isAdmin() {
  return localStorage.getItem("is_admin") === "1";
}

export function getMe() {
  return api.get("/api/me");
}
