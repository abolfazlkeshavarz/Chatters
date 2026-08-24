/**
 * Registers the service worker that powers push notifications and the offline
 * app shell.
 *
 * Skipped on http:// (other than localhost) because service workers require a
 * secure context — which is also why Web Push needs HTTPS in production.
 */
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
      .then((registration) => {
        // Pull in a new build without waiting for every tab to close.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              console.info("A new version of Chatters is ready.");
            }
          });
        });
      })
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}

export function unregister() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch(() => {});
}
