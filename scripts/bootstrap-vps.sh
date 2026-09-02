#!/usr/bin/env bash
#
# Zero-to-deployed setup on a fresh (or already-in-use) Ubuntu/Debian VPS:
# installs Docker, creates .env, and brings the stack up — automatically
# adapting if ports 80/443 already belong to another project on the same
# server, rather than failing on "port is already allocated".
#
# Usage (from the project root, after git clone):
#   ./scripts/bootstrap-vps.sh
#
# You can supply the domain and admin account up front so nothing is prompted:
#   DOMAIN=chat.example.com ADMIN_USERNAME=admin ./scripts/bootstrap-vps.sh
#
# The script re-execs itself with sudo; you don't need to put "sudo" in front
# of it.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/lib.sh

# ------------------------------------------------------------- elevate to root
if [[ "$(id -u)" != "0" ]]; then
  echo "==> Root access is required to install Docker; re-running with sudo"
  exec sudo -E bash "$0" "$@"
fi

REAL_USER="${SUDO_USER:-root}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script is written only for Ubuntu/Debian (apt)." >&2
  exit 1
fi

# --------------------------------------------------------- base packages
echo "==> Installing base packages"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg make openssl git

# --------------------------------------------------------------- Docker Engine
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "    Docker installed."
else
  echo "==> Docker is already installed"
  echo "    (shared with any other project already running on this server — that's fine,"
  echo "     Docker itself supports any number of independent compose projects side by side)"
fi

if [[ "$REAL_USER" != "root" ]] && ! id -nG "$REAL_USER" | grep -qw docker; then
  echo "==> Adding user $REAL_USER to the docker group"
  usermod -aG docker "$REAL_USER"
  echo "    Note: you must log out/in again to run docker without sudo."
fi

# --------------------------------------------------------------- domain and email
if [[ -z "${DOMAIN:-}" ]]; then
  read -r -p "Domain Chatters will be reachable at (A record already pointing here): " DOMAIN
fi
: "${DOMAIN:?DOMAIN is required}"

if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
  read -r -p "Email for Let's Encrypt expiry notices (blank to use admin@${DOMAIN}): " LETSENCRYPT_EMAIL
  LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-admin@${DOMAIN}}"
fi

if [[ -z "${ADMIN_USERNAME:-}" ]]; then
  read -r -p "Username for the first administrator account: " ADMIN_USERNAME
fi
: "${ADMIN_USERNAME:?ADMIN_USERNAME is required}"

# The backend's boot-time admin bootstrap hashes whatever ADMIN_PASSWORD it is
# given without checking its strength (unlike the registration/admin-create
# API paths, which do) — so a too-short password typed here would otherwise
# be accepted silently. 8 characters mirrors validate.Password's own minimum.
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  while true; do
    read -r -s -p "Password for the first administrator account (min 8 characters): " ADMIN_PASSWORD
    echo
    if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
      echo "  Too short - needs at least 8 characters. Try again."
      continue
    fi
    read -r -s -p "Confirm password: " ADMIN_PASSWORD_CONFIRM
    echo
    if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
      echo "  Passwords did not match. Try again."
      continue
    fi
    unset ADMIN_PASSWORD_CONFIRM
    break
  done
fi
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"

# --------------------------------------------------------- build mirrors
#
# Only affects docker compose build (Go module downloads, npm install) — not
# anything at runtime. Skippable non-interactively with MIRRORS=1 or MIRRORS=0,
# matching the flag other Chatters-adjacent tooling uses for the same purpose.
if [[ -z "${MIRRORS:-}" ]]; then
  read -r -p "Use package mirrors (package-mirror.liara.ir) for the Go/npm build, e.g. for a network where the real registries are slow or blocked? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] && MIRRORS=1 || MIRRORS=0
fi

if [[ "$MIRRORS" == "1" ]]; then
  echo "==> Using package-mirror.liara.ir for the Go and npm build"
  GOPROXY="https://package-mirror.liara.ir/repository/go/,direct"
  GOSUMDB="off"
  NPM_REGISTRY="https://package-mirror.liara.ir/repository/npm/"
fi

# --------------------------------------------------------- proxy port
#
# The layout is: host nginx owns 80/443 and routes each subdomain to its
# project's loopback port. So Chatters never binds a public port itself — it
# only needs a free loopback one for nginx to proxy to.
echo "==> Choosing a loopback port for Chatters"
CHAT_PORT="${CHAT_PORT:-$(find_free_port 8082)}"
echo "    127.0.0.1:${CHAT_PORT}"

# Whether host nginx can be set up now depends on who holds 80/443. Checked
# early so the answer is known before anything is built, rather than after.
PROXY_READY=1
for p in 80 443; do
  owner="$(port_owner "$p" || true)"
  if [[ -n "$owner" && "$owner" != "nginx" ]]; then
    PROXY_READY=0
    echo ""
    echo "    Note: port ${p} is held by \"${owner}\", not nginx."
    echo "    Chatters will still be deployed, but the reverse proxy and"
    echo "    certificate step will be skipped — see the instructions printed"
    echo "    at the end of this run."
  fi
done

# ------------------------------------------------------------------- .env
echo "==> Creating .env file"
make env
bash scripts/gen-secrets.sh

sed -i "s|^HTTP_PORT=.*|HTTP_PORT=127.0.0.1:${CHAT_PORT}|" .env

sed -i "s|^ADMIN_USERNAME=.*|ADMIN_USERNAME=${ADMIN_USERNAME}|" .env
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" .env
sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=admin@${DOMAIN}|" .env

if [[ "$MIRRORS" == "1" ]]; then
  sed -i "s|^GOPROXY=.*|GOPROXY=${GOPROXY}|" .env
  sed -i "s|^GOSUMDB=.*|GOSUMDB=${GOSUMDB}|" .env
  sed -i "s|^NPM_REGISTRY=.*|NPM_REGISTRY=${NPM_REGISTRY}|" .env
fi

if [[ "$REAL_USER" != "root" ]]; then
  chown "$REAL_USER":"$REAL_USER" .env
fi
chmod 600 .env

# --------------------------------------------------------------- deploy
#
# If the images are already here — loaded from a bundle built on a bigger
# machine (scripts/load-images.sh) — don't rebuild them. Building the
# frontend needs roughly 1.5 GB of RAM, which a small VPS does not
# necessarily have, so on those the whole point is to never build here.
if docker image inspect chatters-backend:latest >/dev/null 2>&1 \
   && docker image inspect chatters-frontend:latest >/dev/null 2>&1; then
  echo "==> Prebuilt images found; skipping the build"
  BUILD_ARGS=(--no-build)
else
  echo "==> Building images (no prebuilt images found)"
  echo "    On a small server this can be slow, and the frontend build may run"
  echo "    out of memory. If it fails, build on a bigger machine instead:"
  echo "    see DEPLOY.md, \"Building elsewhere\"."
  docker compose build
  BUILD_ARGS=()
fi

echo "==> Bringing the system up"
# --wait blocks until every service with a healthcheck reports healthy (db,
# redis, backend) rather than returning as soon as the containers start,
# so the summary printed below is trustworthy rather than optimistic.
docker compose up -d --wait "${BUILD_ARGS[@]}"

echo ""
echo "================================================================"
echo " Chatters containers are running."
echo " Admin username: ${ADMIN_USERNAME}"
echo " Admin password: ${ADMIN_PASSWORD}"
echo " (also saved in .env — change it once you've signed in)"
echo "================================================================"
echo ""

# --------------------------------------------------- reverse proxy + SSL
if [[ "$PROXY_READY" == "1" ]]; then
  echo "==> Setting up host nginx and the SSL certificate for ${DOMAIN}"
  echo ""
  DOMAIN="$DOMAIN" \
  CHAT_PORT="$CHAT_PORT" \
  LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-admin@${DOMAIN}}" \
  STAGING="${STAGING:-0}" \
    bash scripts/setup-nginx.sh
else
  cat <<EOF

------------------------------------------------------------------------
Chatters is running on 127.0.0.1:${CHAT_PORT}, but the reverse proxy step
was SKIPPED because ports 80/443 are held by something other than nginx.

This deployment expects host-level nginx to own 80/443 and route each
subdomain to its project's loopback port. To finish:

1) Move whatever currently holds those ports behind host nginx too. If it
   is another Docker project publishing 80/443 from a container, change
   its compose file from:
       ports: ["80:80", "443:443"]
   to a loopback port, e.g.:
       ports: ["127.0.0.1:8081:80"]
   drop its 443 mapping, then: docker compose up -d

2) Re-run the proxy setup for Chatters:
       sudo ./scripts/setup-nginx.sh

3) Give that other project its own server block the same way, pointing at
   its loopback port, and let the host certbot handle its certificate too.

If you would instead rather keep that project owning 80/443 and have IT
proxy to Chatters, that also works - see DEPLOY.md, Appendix C.
------------------------------------------------------------------------
EOF
fi

echo ""
echo "================================================================"
echo " Admin username: ${ADMIN_USERNAME}"
echo " Admin password: ${ADMIN_PASSWORD}"
echo " (also in .env - change it once you have signed in)"
echo "================================================================"
