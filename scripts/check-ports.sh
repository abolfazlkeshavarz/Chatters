#!/usr/bin/env bash
#
# Reports whether ports 80/443 are free, which decides how Chatters can be
# exposed on this server. Standalone (make check-ports) and also called by
# bootstrap-vps.sh so deployment adapts automatically instead of failing on
# "port is already allocated" after the fact.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/lib.sh

echo "Checking host ports 80 and 443..."
echo ""

http_free=1
https_free=1
port_in_use 80 || http_free=0
port_in_use 443 || https_free=0

if [[ "$http_free" == 0 && "$https_free" == 0 ]]; then
  echo "  80 and 443 are free."
  echo ""
  echo "Chatters can bind them directly and manage its own certificate. Use the"
  echo "normal single-project flow:"
  echo "  make bootstrap    (or manually: make deploy && make ssl)"
  exit 0
fi

echo "  Port 80:  $([[ $http_free == 1 ]] && echo 'in use' || echo 'free')"
echo "  Port 443: $([[ $https_free == 1 ]] && echo 'in use' || echo 'free')"
echo ""
echo "Something else on this server — almost certainly another project's own"
echo "web server — already owns at least one of these. Chatters cannot also"
echo "bind them directly; two processes cannot both listen on the same port."
echo ""
echo "This is the normal case on a server that already runs another project."
echo "Chatters will bind to a localhost-only port instead, and you point"
echo "whichever web server already owns 80/443 at it with one added server"
echo "block. Run:"
echo "  make bootstrap"
echo "and it will pick a free port automatically and print the exact steps"
echo "for wiring up the public domain afterwards. See also the \"Deploying"
echo "alongside another project\" section in DEPLOY.md."
