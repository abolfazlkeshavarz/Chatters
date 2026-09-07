/**
 * Native push via expo-notifications.
 *
 * The web app uses Web Push + a service worker; the backend now also speaks
 * Expo's push protocol (see internal/push/expo.go). Here we obtain this
 * install's ExponentPushToken, hand it to the backend, and route a tapped
 * notification to the right chat.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { EAS_PROJECT_ID } from "../config";
import { registerDevice, unregisterDevice } from "../api/push";

const TOKEN_CACHE_KEY = "chatters.pushToken";

// While the app is foregrounded the WebSocket already delivered the message and
// updated the UI, so a heads-up banner would be redundant noise — show it only
// in the notification centre. Backgrounded/killed delivery is unaffected.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 51 key:
    shouldShowAlert: false,
    // SDK 52+ keys (ignored on older runtimes):
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function configureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Messages",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#2f6fed",
  });
}

/**
 * Ask for permission (if not already decided), get the Expo push token, and
 * register it with the backend. Safe to call on every launch and after every
 * login. Returns the token, or null if unavailable / denied.
 */
export async function registerForPush() {
  if (!Device.isDevice) {
    return null; // no push tokens on a simulator/emulator
  }

  await configureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return null;

  let token;
  try {
    const res = await Notifications.getExpoPushTokenAsync(
      EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined
    );
    token = res.data;
  } catch (err) {
    console.warn("push token fetch failed:", err.message);
    return null;
  }

  try {
    await registerDevice(token, Platform.OS);
    await AsyncStorage.setItem(TOKEN_CACHE_KEY, token);
  } catch (err) {
    console.warn("device registration failed:", err.message);
  }

  return token;
}

/** Whether a push token is currently registered for this install. */
export async function getStoredPushToken() {
  try {
    return await AsyncStorage.getItem(TOKEN_CACHE_KEY);
  } catch {
    return null;
  }
}

/** Drop this install's token from the backend, e.g. on sign-out. */
export async function unregisterForPush() {
  try {
    const token = await AsyncStorage.getItem(TOKEN_CACHE_KEY);
    if (token) await unregisterDevice(token);
    await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
  } catch {
    /* best effort */
  }
}

/**
 * Wire notification taps to navigation. `onOpenChat(chatId)` is called for the
 * notification that launched the app from cold and for any tapped while it
 * runs. Returns an unsubscribe function.
 */
export function attachNotificationRouting(onOpenChat) {
  Notifications.getLastNotificationResponseAsync().then((response) => {
    const chatId = response?.notification?.request?.content?.data?.chat_id;
    if (chatId) onOpenChat(String(chatId));
  });

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const chatId = response?.notification?.request?.content?.data?.chat_id;
    if (chatId) onOpenChat(String(chatId));
  });

  return () => sub.remove();
}
