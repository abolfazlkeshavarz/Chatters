/**
 * Registers the service worker that powers push notifications and the offline
 * app shell, and tells the rest of the app when a newer version is waiting.
 *
 * Skipped on http:// (other than localhost) because service workers require a
 * secure context — which is also why Web Push needs HTTPS in production.
 *
 * Updating: a new build ships a service worker whose bytes differ (the
 * Dockerfile stamps a build id into it). The browser installs it in the
 * background but it stays "waiting" — see sw.js — until applyUpdate() asks it
 * to take over and the page reloads onto the new bundle. An installed PWA is
 * rarely fully closed, especially on iOS, so nothing here relies on the user
 * quitting the app: we re-check whenever it comes back to the foreground and
 * on a timer.
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;

let registration = null;
let updateReady = false;
const listeners = new Set();

function setUpdateReady(value) {
  if (value === updateReady) return;
  updateReady = value;
  listeners.forEach((fn) => fn(value));
}

/** Calls fn now and whenever "a new version is ready" changes. Returns unsubscribe. */
export function subscribeUpdate(fn) {
  listeners.add(fn);
  fn(updateReady);
  return () => listeners.delete(fn);
}

// A waiting worker only counts as an update when a page is already being
// controlled; on the very first install there is nothing to update from.
function flagIfWaiting(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
}

function watch(reg) {
  flagIfWaiting(reg);
  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") flagIfWaiting(reg);
    });
  });
}

function whenSettled(worker, timeoutMs) {
  return new Promise((resolve) => {
    if (!worker || worker.state === "installed" || worker.state === "activated") {
      resolve();
      return;
    }
    const done = () => {
      worker.removeEventListener("statechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (worker.state === "installed" || worker.state === "redundant") done();
    };
    const timer = setTimeout(done, timeoutMs);
    worker.addEventListener("statechange", onChange);
  });
}

/**
 * Asks the browser to look for a new service worker now and resolves to
 * whether one is ready to apply. Never rejects: offline just means "no".
 */
export async function checkForUpdate() {
  if (!registration) return false;
  try {
    await registration.update();
    await whenSettled(registration.installing, 15000);
    flagIfWaiting(registration);
  } catch {
    /* offline or the server is mid-deploy; try again later */
  }
  return updateReady;
}

/** Switches to the waiting version and reloads the page onto it. */
export function applyUpdate() {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  const waiting = registration && registration.waiting;
  if (!waiting) {
    reload();
    return;
  }

  navigator.serviceWorker.addEventListener("controllerchange", reload);
  waiting.postMessage({ type: "SKIP_WAITING" });
  // If the browser never reports the switch, reload anyway rather than leave
  // the button spinning; the new worker takes over on the next load.
  setTimeout(reload, 4000);
}

export function register() {
  if (!("serviceWorker" in navigator)) return;

  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname
  );
  if (window.location.protocol !== "https:" && !isLocalhost) {
    console.info("Service worker skipped: requires HTTPS.");
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${process.env.PUBLIC_URL || ""}/sw.js`)
      .then((reg) => {
        registration = reg;
        watch(reg);

        const check = () => reg.update().catch(() => {});
        // Coming back to the app is the moment a stale copy matters most, and
        // on iOS the only reliable trigger since the page is frozen, not closed.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("online", check);
        setInterval(check, CHECK_EVERY_MS);
      })
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}

export function unregister() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.unregister())
    .catch(() => {});
}
