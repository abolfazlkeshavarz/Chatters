# Chatters — Flutter apps

Native Android and iOS clients for the Chatters backend, written in Flutter.
The backend is unchanged: the apps call the same REST API and WebSocket as the
web app, and stay wire-compatible with its end-to-end encryption.

| Directory | What it is |
| --- | --- |
| `chatters_shared/` | All app code: API client, WebSocket, E2EE crypto, screens. Used by both apps. |
| `chatters_android/` | The Android app (Android platform only). |
| `chatters_ios/` | The iOS app (iOS platform only). |

Each app's `lib/main.dart` just calls `runChattersApp()` from the shared
package, so a fix in `chatters_shared` lands on both platforms.

## Features

**Design.** A "glass and aurora" design system: animated gradient backdrops,
frosted-glass bars and sheets, gradient message bubbles, five accent themes
(Aurora, Ocean, Sunset, Mint, Grape), light / dark / automatic mode, an
optional chat wallpaper, the Vazirmatn typeface (Persian + Latin), haptics and
spring animations throughout. All preferences are stored on the device.

**Chats.** Large-title chat list with search, All / Unread / Groups / Secret
filters, a contacts row, announcement cards from the admin, swipe right to
mute and left to delete, and an unread badge on the tab bar. Conversations
group consecutive messages, show day separators and read ticks
(sent / delivered / read), render emoji-only messages large, support
swipe-to-reply, a long-press action sheet (reply, copy, share, delete for me /
everyone), inline photos with a zoomable, swipe-to-dismiss viewer, file cards,
and a jump-to-latest button with a new-message counter.

**Secret chats.** P-256 ECDH + AES-GCM end-to-end encryption, invitation
screen with accept / decline, self-destruct timers with live countdowns and a
safety-number verification sheet.

**Contacts & settings.** Alphabetical contacts with quick Message / Secret chat
actions, new-group builder, profile photo (library or camera) and visibility,
username and password changes.

**Languages.** English, Persian (فارسی, full right-to-left layout with
Persian digits) and Italian, switchable in Settings or from the globe button
on the sign-in screen; "Auto" follows the phone's language. Strings live in
`chatters_shared/lib/src/ui/l10n.dart`, keyed by the English text. Each
message picks its own text direction, so English inside Persian (and the
reverse) reads correctly.

**Fonts.** On iOS the apps use Apple's own system fonts: SF Pro for English
and Italian, SF Arabic (the font of the Persian keyboard) for Persian. Apple's
license only allows those fonts on Apple platforms, so Android uses the closest
open-source equivalents, bundled in `chatters_shared/assets/fonts` (SIL OFL):
Inter, which is designed in the same style as SF, and Vazirmatn for Persian.

Administration is intentionally not in the apps; admins use the web panel.

The crypto in `chatters_shared/lib/src/crypto/e2ee.dart` is tested against a
fixture produced by the web app's `frontend/src/crypto/e2ee.js`
(`chatters_shared/test/e2ee_test.dart`), so keys and messages move freely
between the web, the old React Native app and these apps.

## Backend URL

Defaults to `https://chat.abolfazl.fun`. Override at build time:

```bash
flutter build apk --dart-define=API_BASE=https://your.server
```

## Android APK

The **Build Flutter Android APK** workflow (`.github/workflows/flutter-android-apk.yml`)
builds `chatters.apk` on every push that touches `flutter/`, and publishes it on
the GitHub Release **`flutter-android-latest`** (also kept as a workflow
artifact). Download it on the phone and install (allow "install unknown apps").

Build locally instead:

```bash
cd flutter/chatters_android
flutter pub get
flutter build apk --release
# -> build/app/outputs/flutter-apk/app-release.apk
```

**Signing.** Without a keystore the release APK is signed with a debug key: it
installs fine, but an APK built on another machine / CI run cannot upgrade it
in place (uninstall first). For stable updates create a keystore once:

```bash
keytool -genkey -v -keystore chatters.jks -keyalg RSA -keysize 2048 -validity 10000 -alias chatters
```

then either add `flutter/chatters_android/android/key.properties`
(`storeFile=`, `storePassword=`, `keyAlias=`, `keyPassword=`; it is git-ignored)
or set the repo secrets `CHATTERS_KEYSTORE_BASE64` (`base64 -w0 chatters.jks`),
`CHATTERS_KEYSTORE_PASSWORD`, `CHATTERS_KEY_ALIAS`, `CHATTERS_KEY_PASSWORD`.

## iOS

Code only for now: it needs a Mac with Xcode to build and an Apple Developer
account to install on devices / ship.

```bash
cd flutter/chatters_ios
flutter pub get
open ios/Runner.xcworkspace     # set your Team under Signing & Capabilities
flutter run --release           # on a connected iPhone
flutter build ipa               # for TestFlight / App Store
```

Bundle id is `com.chatters.messenger` (change it in Xcode if it is taken). The
**Check Flutter iOS build** workflow does an unsigned compile on a macOS runner
(manual trigger).

## Notifications

The apps show a local notification for new messages that arrive over the live
connection while that chat is not open (including shortly after the app goes
to the background). True background push when the app is fully closed needs
Firebase Cloud Messaging / APNs keys plus a backend sender; the backend today
only sends Web Push and Expo push (for the React Native app), so that is left
for the deployment phase.
