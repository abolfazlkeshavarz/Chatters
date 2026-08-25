#!/usr/bin/env bash
# Generates a locally-trusted TLS certificate covering this machine's network
# addresses, so a phone on the same Wi-Fi can reach the app over HTTPS.
#
# Uses mkcert, which creates a local certificate authority and installs it in
# this machine's trust store. That CA then has to be installed on each phone
# too - see HELP.md.
#
# A plain self-signed certificate is deliberately NOT offered as a fallback:
# browsers refuse to register a service worker when certificate validation
# fails, even if the user clicks through the interstitial, so notifications
# would silently never work and the failure would look like an app bug.
set -euo pipefail

cd "$(dirname "$0")/.."
CERT_DIR=certs

if ! command -v mkcert >/dev/null 2>&1; then
  cat <<'EOF'
mkcert is not installed.

It creates a certificate authority trusted by this machine, which is what
lets a service worker (and therefore notifications) run over a LAN address.

  macOS          brew install mkcert nss
  Linux          apt install libnss3-tools && \
                   curl -L -o mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 && \
                   chmod +x mkcert && sudo mv mkcert /usr/local/bin/
  Windows        choco install mkcert     (or: scoop install mkcert)

Then run this again. If you would rather not install anything, use a tunnel
instead - see "make tunnel" - which gives you a publicly trusted certificate
with nothing to install on the phone.
EOF
  exit 1
fi

# Addresses this machine can be reached at, so the certificate is valid for
# whichever one the phone uses.
hosts="localhost 127.0.0.1 ::1"
if command -v node >/dev/null 2>&1; then
  lan=$(node -e '
    const os = require("os");
    const out = [];
    for (const list of Object.values(os.networkInterfaces() || {})) {
      for (const n of list || []) {
        if (n.family === "IPv4" && !n.internal) out.push(n.address);
      }
    }
    console.log(out.join(" "));
  ' 2>/dev/null || true)
  hosts="$hosts $lan"
fi

mkdir -p "$CERT_DIR"

echo "Installing the local certificate authority (may prompt for your password)"
mkcert -install

echo
echo "Issuing a certificate for: $hosts"
# shellcheck disable=SC2086
mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" $hosts

echo
echo "Wrote $CERT_DIR/cert.pem and $CERT_DIR/key.pem"
echo
echo "The CA that signs it lives at:"
echo "    $(mkcert -CAROOT)/rootCA.pem"
echo
echo "Copy that file to each phone and trust it - see the 'Testing on a phone'"
echo "section of HELP.md for the per-platform steps."
