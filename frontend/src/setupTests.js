// jest-dom adds custom jest matchers for asserting on DOM nodes.
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

import { TextDecoder, TextEncoder } from "node:util";
import { webcrypto } from "node:crypto";

/*
 * Browsers give us these; the Jest environments bundled with react-scripts 5
 * do not. jsdom omits TextEncoder/TextDecoder, and neither the jsdom nor the
 * node environment exposes Web Crypto, because Jest builds its own global
 * object rather than reusing Node's.
 *
 * Polyfilling here — rather than weakening the code to cope — keeps the
 * encryption module testable while it stays written against the standard
 * browser APIs it uses in production.
 */
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
