/* eslint-disable no-restricted-globals */
/**
 * Chatters service worker.
 *
 * Responsibilities:
 *   1. Receive Web Push messages and raise a notification.
 *   2. Focus (or open) the app when a notification is tapped.
 *   3. Serve the app shell offline so a cold launch with no network still
 *      renders something instead of the browser error page.
 *
 * Deliberately NOT cached: anything under /api/. Message data is either
 * private or end-to-end encrypted, and a stale cached copy would be worse
 * than a network error.
 */

const CACHE = "chatters-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/favicon.png", "/logo192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individual failures (a missing icon) must not abort the install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/login" || url.pathname === "/register") return;

  // Navigations: network first so the user gets fresh HTML, falling back to
  // the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() =>
          caches.match("/index.html").then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Hashed build assets: cache first, they are immutable.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Chatters", body: "New message" };
  }

  const title = payload.title || "Chatters";
  const options = {
    body: payload.body || "New message",
    icon: "/logo192.png",
    badge: "/logo192.png",
    // Collapse repeated notifications from the same conversation.
    tag: payload.chat_id ? `chat-${payload.chat_id}` : "chatters",
    renotify: true,
    data: { chatId: payload.chat_id || null, url: "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const chatId = event.notification.data && event.notification.data.chatId;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            // Let the running app route to the conversation rather than
            // reloading the whole SPA.
            client.postMessage({ type: "open-chat", chatId });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(chatId ? `/?chat=${chatId}` : "/");
        }
        return undefined;
      })
  );
});
