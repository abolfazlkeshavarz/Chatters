import { api } from "./client";

/**
 * Native-app push registration. The web app negotiates a Web Push subscription
 * with the service worker; the app instead hands the backend the Expo push
 * token obtained from expo-notifications (see src/services/notifications.js).
 */

export function registerDevice(token, platform) {
  return api.post("/api/push/device", { token, platform });
}

export function unregisterDevice(token) {
  return api.post("/api/push/device/unregister", { token });
}
