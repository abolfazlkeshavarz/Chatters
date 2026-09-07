/**
 * Caches the unlocked identity key between launches.
 *
 * The web app keeps a non-extractable CryptoKey in IndexedDB. React Native's
 * crypto keys are not persistable objects, so instead the PKCS8 bytes are held
 * in expo-secure-store (iOS Keychain / Android Keystore, hardware-backed) and
 * re-imported into a CryptoKey on load. The user is therefore not asked for
 * their password on every launch, and the material never touches JS-readable
 * storage like AsyncStorage.
 *
 * Everything is scoped to a username: a shared device must never hand one
 * account's key to another.
 */

import * as SecureStore from "expo-secure-store";
import {
  importPrivateKey,
  toBase64,
  fromBase64,
} from "./e2ee";

const STORE_KEY = "chatters.identity.v1";

/**
 * @param {{username: string, privateKeyPkcs8: Uint8Array, publicKeyB64: string}} identity
 */
export async function saveIdentity(identity) {
  try {
    const record = JSON.stringify({
      username: identity.username,
      privateKeyPkcs8B64: toBase64(identity.privateKeyPkcs8),
      publicKeyB64: identity.publicKeyB64,
    });
    await SecureStore.setItemAsync(STORE_KEY, record);
  } catch {
    // Secure storage can be unavailable (e.g. no device passcode set on older
    // Android). Secure chat still works for this launch; the user re-unlocks
    // by signing in again next time.
  }
}

/**
 * Returns { username, publicKeyB64, privateKey } for the signed-in user, or
 * null if nothing is stored / it belongs to someone else / it cannot be
 * re-imported.
 */
export async function loadIdentity(username) {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return null;

    const record = JSON.parse(raw);
    if (!record || record.username !== username) return null;

    const privateKey = await importPrivateKey(
      fromBase64(record.privateKeyPkcs8B64),
      false
    );

    return {
      username: record.username,
      publicKeyB64: record.publicKeyB64,
      privateKey,
    };
  } catch {
    return null;
  }
}

export async function clearIdentity() {
  try {
    await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    /* nothing worth surfacing on logout */
  }
}
