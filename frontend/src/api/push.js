import { api } from "./client";

/**
 * Web Push subscription management.
 *
 * iOS note: Safari only exposes the Push API to a PWA that has been added to
 * the Home Screen (iOS 16.4+). In a normal Safari tab `PushManager` is absent,
 * which is why `pushSupport()` reports a distinct reason instead of a bare
 * false — the UI uses it to tell iOS users what to do.
 */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac, distinguishable by touch support.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function pushSupport() {
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "This browser does not support service workers." };
  }
  if (!("Notification" in window)) {
    return { supported: false, reason: "This browser does not support notifications." };
  }
  if (!("PushManager" in window)) {
    if (isIOS() && !isStandalone()) {
      return {
        supported: false,
        reason:
          "On iPhone and iPad, notifications work only after you add Chatters to your Home Screen: tap Share, then “Add to Home Screen”, and open it from there.",
      };
    }
    return { supported: false, reason: "This browser does not support push notifications." };
  }
  return { supported: true, reason: "" };
}

export function permission() {
  return "Notification" in window ? Notification.permission : "denied";
}

/** Prompts for permission and registers a subscription with the backend. */
export async function enablePush() {
  const support = pushSupport();
  if (!support.supported) throw new Error(support.reason);

  const { public_key: publicKey, enabled } = await api.get(
    "/api/push/vapid-public-key"
  );
  if (!enabled || !publicKey) {
    throw new Error("Push notifications are not configured on this server.");
  }

  const result = await Notification.requestPermission();
  if (result !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.ready;

  // Reuse an existing subscription; re-subscribing with a different key throws.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  await api.post("/api/push/subscribe", {
    endpoint: json.endpoint,
    keys: json.keys,
  });

  return true;
}

export async function disablePush() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await api.post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export async function isSubscribed() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}
