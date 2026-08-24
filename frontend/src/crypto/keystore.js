/**
 * Caches the unlocked identity key between sessions.
 *
 * The private key is held in IndexedDB as a CryptoKey imported with
 * extractable=false. The browser will happily use it for key agreement but
 * will not hand the raw bytes back to JavaScript, so even a script-injection
 * bug cannot copy the key out. This is strictly safer than keeping the
 * material in localStorage, and it survives the PWA being closed and reopened
 * so the user is not asked for their password on every launch.
 */

const DB_NAME = "chatters-keys";
const DB_VERSION = 1;
const STORE = "identity";
const RECORD = "current";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {{username: string, privateKey: CryptoKey, publicKeyB64: string}} identity
 */
export async function saveIdentity(identity) {
  try {
    const db = await openDB();
    await tx(db, "readwrite", (store) =>
      store.put(
        {
          username: identity.username,
          privateKey: identity.privateKey,
          publicKeyB64: identity.publicKeyB64,
        },
        RECORD
      )
    );
    db.close();
  } catch {
    // A private-browsing window may refuse IndexedDB. Secure chat still works
    // for the current page load, the user just re-unlocks next time.
  }
}

/**
 * Returns the cached identity, but only if it belongs to the user currently
 * signed in — otherwise a shared device would hand one account's key to
 * another.
 */
export async function loadIdentity(username) {
  try {
    const db = await openDB();
    const record = await tx(db, "readonly", (store) => store.get(RECORD));
    db.close();

    if (!record || record.username !== username) return null;
    return record;
  } catch {
    return null;
  }
}

export async function clearIdentity() {
  try {
    const db = await openDB();
    await tx(db, "readwrite", (store) => store.delete(RECORD));
    db.close();
  } catch {
    /* nothing worth surfacing on logout */
  }
}
