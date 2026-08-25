#!/usr/bin/env bash
# Puts the running stack behind a temporary public HTTPS URL using a Cloudflare
# quick tunnel. The certificate is publicly trusted, so nothing needs to be
# installed on the phone - which makes this the path of least resistance for
# iOS, where trusting a private certificate authority takes several steps.
#
# The trade-off: while this runs, your development instance is reachable from
# the internet by anyone who has the URL. The hostname is random and the tunnel
# dies when you stop it, but do not leave it running unattended.
set -uo pipefail

cd "$(dirname "$0")/.."

if ! docker compose ps --status running --services 2>/dev/null | grep -q frontend; then
  echo "The stack is not running. Start it first:"
  echo "    make up"
  exit 1
fi

cat <<'EOF'

Starting a Cloudflare quick tunnel.

Your development instance will be publicly reachable at the URL printed below
for as long as this runs. Press Ctrl-C to stop it.

EOF

# --network joins the compose network so the tunnel can address the frontend
# container directly. The Host header is passed through unmodified, which the
# backend's same-origin check depends on.
docker run --rm -it \
  --network chatters_default \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://frontend:80
