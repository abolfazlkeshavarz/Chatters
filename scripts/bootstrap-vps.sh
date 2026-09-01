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

if [[ -z "${ADMIN_USERNAME:-}" ]]; then
  read -r -p "Username for the first administrator account: " ADMIN_USERNAME
fi
: "${ADMIN_USERNAME:?ADMIN_USERNAME is required}"

# --------------------------------------------------- port conflict detection
#
# The one question that decides everything else: is anything already on
# 80/443? On a server dedicated to Chatters the answer is no and it can own
# them directly, exactly like the single-project flow in DEPLOY.md. On a
# server that already runs another project — the case this script exists to
# handle well — something else almost certainly already does, most likely
# that other project's own containerised web server. Two processes cannot
# both bind the same port, so Chatters has to bind somewhere else and let
# whatever already owns 80/443 forward to it instead.
echo "==> Checking whether ports 80/443 are available"
SHARED_MODE=0
if port_in_use 80 || port_in_use 443; then
  SHARED_MODE=1
  CHAT_PORT="$(find_free_port 8091)"
  echo "    Port 80 and/or 443 are already in use by something else on this server."
  echo "    Chatters will bind to 127.0.0.1:${CHAT_PORT} instead (not exposed publicly"
  echo "    on its own) and you'll add one proxy rule to whatever already owns 80/443."
  echo "    Full instructions are printed at the end of this run, and are also in"
  echo "    DEPLOY.md under \"Deploying alongside another project\"."
else
  echo "    Both are free — Chatters can bind them directly."
fi

# ------------------------------------------------------------------- .env
echo "==> Creating .env file"
make env
bash scripts/gen-secrets.sh

if [[ "$SHARED_MODE" == "1" ]]; then
  sed -i "s|^HTTP_PORT=.*|HTTP_PORT=127.0.0.1:${CHAT_PORT}|" .env
else
  sed -i "s|^HTTP_PORT=.*|HTTP_PORT=80|" .env
fi

sed -i "s|^ADMIN_USERNAME=.*|ADMIN_USERNAME=${ADMIN_USERNAME}|" .env
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '\n/+=' | cut -c1-18)"
fi
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" .env
sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=admin@${DOMAIN}|" .env

if [[ "$REAL_USER" != "root" ]]; then
  chown "$REAL_USER":"$REAL_USER" .env
fi
chmod 600 .env

# --------------------------------------------------------------- deploy
echo "==> Building images and bringing the system up"
docker compose build
# --wait blocks until every service with a healthcheck reports healthy (db,
# redis, backend) rather than returning as soon as the containers start,
# so the summary printed below is trustworthy rather than optimistic.
docker compose up -d --wait

echo ""
echo "================================================================"
echo " Chatters containers are running."
echo " Admin username: ${ADMIN_USERNAME}"
echo " Admin password: ${ADMIN_PASSWORD}"
echo " (also saved in .env — change it once you've signed in)"
echo "================================================================"
echo ""

if [[ "$SHARED_MODE" == "0" ]]; then
  echo "Ports 80/443 were free, so Chatters is already reachable at:"
  echo "  http://${DOMAIN}"
  echo ""
  echo "For HTTPS, follow DEPLOY.md Part 6 (\"HTTPS\") to install nginx + certbot"
  echo "on the host and point it at this container. Once that's done:"
  echo "  https://${DOMAIN}"
  exit 0
fi

cat <<EOF

------------------------------------------------------------------------
Next step: wire chat.example.com-style domain into whatever already owns
ports 80/443 on this server. Chatters itself is only reachable on this
machine, at http://127.0.0.1:${CHAT_PORT} — nothing is exposed publicly yet.

1) Find that other project's nginx configuration (check its docker-compose
   file for what's mounted into its web/nginx service) and add a new server
   block for ${DOMAIN}, proxying everything to Chatters:

    server {
        listen 80;
        server_name ${DOMAIN};
        location / { return 301 https://\$host\$request_uri; }
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;   # match whatever webroot that project's
                                      # certbot already uses
        }
    }

    server {
        listen 443 ssl;
        server_name ${DOMAIN};

        # Path to a certificate for ${DOMAIN} — see step 2 below.
        ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

        location / {
            proxy_pass http://127.0.0.1:${CHAT_PORT};
            proxy_http_version 1.1;

            # \$host, not \$http_host stripped of its port: Chatters checks
            # that a request's Origin matches its Host, so this has to be
            # exactly what the browser sees, or every request gets rejected.
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;

            # Required for live messaging (WebSocket).
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }
    }

   Reload that project's nginx after adding it (e.g. its own
   "docker compose exec web nginx -s reload" or equivalent).

2) Get a certificate for ${DOMAIN}. If that other project already runs its
   own certbot container against a webroot (as in the block above), reuse
   it — run this FROM THAT OTHER PROJECT'S directory, so it reuses its
   existing certbot image and its /etc/letsencrypt volume:

    docker compose run --rm --entrypoint \\
      "certbot certonly --webroot -w /var/www/certbot \\
        --email admin@${DOMAIN} -d ${DOMAIN} \\
        --agree-tos --no-eff-email" certbot

   Its regular "certbot renew" (already scheduled for its own domain) will
   renew this one too from then on — nothing extra to maintain.

Once both are done: https://${DOMAIN}
------------------------------------------------------------------------
EOF
