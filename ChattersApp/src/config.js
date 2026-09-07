/**
 * Where the app talks to the backend.
 *
 * The web build is served from the same origin as the API, so it uses relative
 * paths. A native app has no origin, so every request needs an absolute base
 * URL. Resolution order:
 *
 *   1. EXPO_PUBLIC_API_BASE   — inlined at bundle time (eas.json / .env)
 *   2. expo.extra.apiBase     — the value committed in app.json
 *
 * The WebSocket URL is derived from the same host: http -> ws, https -> wss.
 */

import Constants from "expo-constants";

function resolveApiBase() {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE;
  const fromExtra = Constants.expoConfig?.extra?.apiBase;
  const raw = (fromEnv || fromExtra || "").trim();

  if (!raw) {
    throw new Error(
      "No API base URL configured. Set EXPO_PUBLIC_API_BASE or expo.extra.apiBase."
    );
  }
  return raw.replace(/\/+$/, "");
}

export const API_BASE = resolveApiBase();

export const WS_BASE = API_BASE.replace(/^http(s?):\/\//, (_, s) =>
  s ? "wss://" : "ws://"
);

export const EAS_PROJECT_ID =
  Constants.expoConfig?.extra?.eas?.projectId || undefined;
