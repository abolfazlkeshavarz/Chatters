#!/usr/bin/env bash
# Prints the URLs this machine is reachable at from other devices on the same
# network, for testing on a phone. Dev convenience only.
#
#   lan-url.sh <http-port> [https-port]
#
# With an https port, the secure URLs are printed and the secure-context
# features are reported as available.
set -uo pipefail

PORT="${1:-8080}"
TLS_PORT="${2:-}"

# node's os.networkInterfaces() is the only address lookup that behaves the
# same on Linux, macOS and Git Bash on Windows, so try it first.
addrs=""
if command -v node >/dev/null 2>&1; then
  addrs=$(node -e '
    const os = require("os");
    const out = [];
    for (const list of Object.values(os.networkInterfaces() || {})) {
      for (const n of list || []) {
        if (n.family === "IPv4" && !n.internal) out.push(n.address);
      }
    }
    console.log(out.join("\n"));
  ' 2>/dev/null)
fi

if [ -z "$addrs" ] && command -v hostname >/dev/null 2>&1; then
  addrs=$(hostname -I 2>/dev/null | tr " " "\n" | grep -E "^[0-9]+\." || true)
fi

echo
if [ -z "$addrs" ]; then
  echo "Could not determine this machine's network address automatically."
  echo "Find it yourself (ipconfig / ifconfig / ip addr) and open it on the phone."
else
  echo "Open this on your phone (same Wi-Fi network):"
  echo
  while IFS= read -r ip; do
    [ -z "$ip" ] && continue
    if [ -n "$TLS_PORT" ]; then
      echo "    https://$ip:$TLS_PORT"
    else
      echo "    http://$ip:$PORT"
    fi
  done <<< "$addrs"
fi

if [ -n "$TLS_PORT" ]; then
  cat <<'EOF'

This is a secure context, so everything is available:

    works   sign-in, chats, unread counts, delivery colours
    works   secure (end-to-end encrypted) chats
    works   push notifications and PWA install

The phone must trust the certificate authority that signed this certificate,
or the page will not load and service workers will not register. Install
mkcert's rootCA.pem on the device first - see HELP.md. On iOS you must also
enable full trust for it in Settings, and add the app to the Home Screen
before notifications can be enabled.

EOF
else
  cat <<'EOF'

A LAN address is not a secure context, so the browser disables part of the app:

    unavailable   secure (end-to-end encrypted) chats - needs Web Crypto
    unavailable   push notifications and PWA install - needs a service worker
    works         sign-in, normal chats, unread counts, delivery colours

Sign-in degrades gracefully rather than failing, so everything except those two
features behaves normally. To test them, use "make https" (or "make tunnel").

EOF
fi
