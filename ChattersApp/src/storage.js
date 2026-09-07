/**
 * Replacement for the web app's `localStorage`.
 *
 * The web code reads `token` / `username` / `is_admin` synchronously all over
 * the place. Native secure storage is async, so at startup we `hydrate()` those
 * few values into memory once and then expose synchronous getters. Writes go to
 * the in-memory cache immediately and to the Keychain / Keystore in the
 * background.
 *
 * The auth token and the wrapped identity key live in `expo-secure-store`
 * (hardware-backed on both platforms). Non-secret UI state can fall back to
 * AsyncStorage if SecureStore is unavailable.
 */

import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = ["token", "username", "is_admin"];

const cache = new Map();
let ready = false;

async function secureGet(key) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(`fallback:${key}`);
  }
}

async function secureSet(key, value) {
  try {
    if (value == null) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    if (value == null) await AsyncStorage.removeItem(`fallback:${key}`);
    else await AsyncStorage.setItem(`fallback:${key}`, value);
  }
}

/** Load the synchronously-read values into memory. Call once before rendering. */
export async function hydrate() {
  const entries = await Promise.all(
    KEYS.map(async (k) => [k, await secureGet(k)])
  );
  for (const [k, v] of entries) cache.set(k, v);
  ready = true;
}

export function isHydrated() {
  return ready;
}

export function getItem(key) {
  return cache.has(key) ? cache.get(key) : null;
}

export async function setItem(key, value) {
  cache.set(key, value);
  await secureSet(key, value);
}

export async function removeItem(key) {
  cache.set(key, null);
  await secureSet(key, null);
}

/* Convenience wrappers used by the API + auth layers. */

export const getToken = () => getItem("token");
export const getUsername = () => getItem("username");
export const isAdminStored = () => getItem("is_admin") === "1";

export async function clearSession() {
  await Promise.all(KEYS.map((k) => removeItem(k)));
}
