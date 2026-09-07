/**
 * Runtime shims that must be installed before any other app code runs.
 *
 * React Native's JS engine (Hermes) has no Web Crypto, no Node Buffer, and —
 * on older versions — no base64 helpers. The web app's crypto layer is written
 * against `crypto.subtle`, `btoa`/`atob` and `TextEncoder`/`TextDecoder`, so we
 * provide all of them here and then reuse that code almost unchanged.
 */

import { install } from "react-native-quick-crypto";
import { Buffer } from "buffer";

// 1. Node-style Buffer, used by a few libraries and by our base64 helpers.
if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}

// 2. btoa / atob in terms of Buffer. Hermes ships these on newer RN but not
//    everywhere; defining them unconditionally is harmless and keeps behaviour
//    identical across engine versions.
global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
global.atob = (b64) => Buffer.from(b64, "base64").toString("binary");

// 3. TextEncoder / TextDecoder. Hermes has had these (UTF-8 only, which is all
//    we need) since RN 0.74, but guard anyway for Expo Go / older clients.
if (typeof global.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("text-encoding");
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// 4. Web Crypto (`crypto.getRandomValues`, `crypto.subtle`) backed by native
//    OpenSSL via react-native-quick-crypto. After this call `globalThis.crypto`
//    behaves like the browser's for the primitives e2ee.js uses: ECDH P-256,
//    AES-GCM, PBKDF2, HKDF, SHA-256, and pkcs8/raw key import & export.
install();
