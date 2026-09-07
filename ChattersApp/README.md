# Chatters — mobile app (Android & iOS)

A React Native (Expo) client for the Chatters backend. Feature-parity with the
web PWA: sign-in, 1:1 and group chats, replies, image/file attachments,
avatars, three-state read receipts, safety-number verification, per-chat mute,
the admin panel, and background push notifications via Expo.

**Secret chats (Telegram-style).** Encryption is not an in-place upgrade of an
existing chat any more — "🔒 New secret chat" (or the 🔒 button in a 1:1)
starts a *separate* end-to-end-encrypted conversation, pending until the other
person accepts. Same P-256 / AES-GCM / ECIES scheme, wire-compatible with the
web app so one account works on both. Either member can set a **self-destruct
timer** (off / 5s / 30s / 1m / 1h / 1d / 1w); each message is then deleted that
long after it is sent, on every device, driven by a server sweep plus a local
countdown.

**Deleting.** Long-press a message for "Delete for me" (a per-user tombstone)
or "Delete for everyone" (your own messages, or anything in a secret chat).
Long-press a chat row to leave it (groups / normal 1:1) or delete a secret
chat for both sides.

**Message ordering fix.** Messages now sort purely by the server's sequence id,
so an encrypted conversation renders in exactly the same order on every device
(the old timestamp-based sort lost sub-millisecond precision).

The web app is unchanged and stays in use — this is an additional client.

## Architecture notes

Built on **Expo SDK 53** (React Native 0.79, New Architecture enabled) —
required by `react-native-quick-crypto` v1, which is a Nitro module. Pin
versions are a starting point; `npx expo install --fix` is the source of truth.

| Concern | Web | Mobile |
| --- | --- | --- |
| Crypto | `window.crypto.subtle` | `react-native-quick-crypto` v1 (native OpenSSL via Nitro), installed in `src/polyfills.js` |
| Token / key storage | `localStorage` + IndexedDB | `expo-secure-store` (Keychain / Keystore), hydrated into a sync cache at launch |
| Realtime | `WebSocket` + page visibility events | `WebSocket` + `AppState` + NetInfo |
| Push | Web Push + service worker (VAPID) | Expo push tokens → new backend endpoint `POST /api/push/device` |
| Base URL | same-origin, relative | absolute, from `EXPO_PUBLIC_API_BASE` / `app.json` → `extra.apiBase` |

Source layout mirrors `frontend/src/` so changes map across: `src/api`,
`src/crypto`, `src/services/websocket.js`, `src/hooks/useChat.js`, plus
`src/screens` (was `pages`) and `src/components`.

## Backend changes that ship with this

Native push (Web Push is untouched):

- `device_push_tokens` table, `internal/push/expo.go` (sends to
  `https://exp.host/--/api/v2/push/send`), `POST /api/push/device[/unregister]`
- `push.Notify()` fans out to Web Push + Expo; offline-push guards changed from
  `push.Enabled()` to `push.Active()`
- config: `EXPO_PUSH_ENABLED` (default true), `EXPO_ACCESS_TOKEN` (optional)

Delete / secret chats / timers (shared by web and mobile):

- `message_deletions` table (per-user "delete for me"); `chats.is_secret`,
  `chats.self_destruct_seconds`, `messages.expires_at` columns
- `POST /api/secret-chats`, `PUT /api/chats/:id/self-destruct`,
  `DELETE /api/chats/:id`, `DELETE /api/messages/:id`
- `websocket.StartExpirySweep` deletes expired messages every 5s and broadcasts
  `{type:"deleted"}`; `chat_deleted` / `timer` / `is_system` socket events
- `GetMessages` / `GetChats` filter deleted-for-me + expired rows and order by
  `id` only (the ordering fix)
- Admin: `GET /api/admin/chats`, `GET /api/admin/chats/:id/messages`,
  `DELETE /api/admin/chats/:id`, `DELETE /api/admin/messages/:id` — a
  "Chats & messages" tab in the **web** admin panel (mobile admin is unchanged)

No Firebase server key is needed for Expo's gateway. For **standalone** builds
(not Expo Go) you still need FCM credentials uploaded to EAS so Android can
receive the push at all — see "Push setup" below.

## Prerequisites

- Node 18+
- An Expo account (`npx expo login`) and EAS CLI (`npm i -g eas-cli`)
- For local device builds: Android Studio (Android) and/or Xcode on a Mac (iOS).
  Windows users build iOS through EAS cloud.
- This app uses a native module (`react-native-quick-crypto`), so **Expo Go
  will not work** — you run a *development build* / *dev client*.

## First-time setup

```bash
cd ChattersApp
npm install
cp .env.example .env          # set EXPO_PUBLIC_API_BASE to a device-reachable URL
npx expo install --fix        # aligns native package versions to the Expo SDK
```

Set the API base URL in **two** places:

- `.env` → `EXPO_PUBLIC_API_BASE` (used by `expo start` / `expo run:*`)
- `app.json` → `expo.extra.apiBase` (baked-in fallback)
- `eas.json` → per-profile `env.EXPO_PUBLIC_API_BASE` (used by EAS builds)

Then link an EAS project (writes the real `extra.eas.projectId`):

```bash
eas init
```

## Run locally (development build)

```bash
# Android (device or emulator attached)
npx expo run:android
# iOS (Mac only)
npx expo run:ios
```

That compiles the native app once and starts Metro. Subsequent JS changes hot-
reload; you only rebuild when native deps change.

To iterate without a local toolchain, build a dev client in the cloud and
install the artifact on your device:

```bash
eas build --profile development --platform android
npx expo start --dev-client
```

## Store / distribution builds

```bash
# Android APK for sideloading / internal testing
eas build --profile preview --platform android

# Production (App Store / Play Store)
eas build --profile production --platform all
eas submit --profile production --platform android   # or ios
```

`android.package` / `ios.bundleIdentifier` are `com.chatters.app` — change them
in `app.json` before submitting under your own developer accounts (Apple
Developer Program, $99/yr; Google Play, $25 one-off).

## Push setup

1. Native push requires a development or production build (not Expo Go).
2. Android: create a Firebase project, download `google-services.json`, and
   upload the **FCM v1 service-account key** to EAS:
   `eas credentials` → Android → *Google Service Account*. Expo relays through
   FCM using it.
3. iOS: EAS manages the APNs key automatically when you run an iOS build while
   logged in to an Apple account with push enabled.
4. The app calls `registerForPush()` after login (see `AuthContext`), which
   requests permission, gets the `ExponentPushToken`, and `POST`s it to
   `/api/push/device`. Toggle it later from the Profile screen.
5. Server: set `EXPO_PUSH_ENABLED=true` (default) and optionally
   `EXPO_ACCESS_TOKEN` in the backend `.env`.

## Known gaps / follow-ups

- Custom app icon & splash image are not included — Expo's defaults are used
  until you drop `assets/icon.png` etc. and re-add the paths to `app.json`.
- Vazirmatn is not bundled (RN needs `.ttf`/`.otf`, the web app ships `.woff2`);
  the system font is used. Add the TTFs + `expo-font` to match the web
  typography.
- Admin "reset password" uses `Alert.prompt`, which is iOS-only; on Android use
  the web admin panel for that one action.
