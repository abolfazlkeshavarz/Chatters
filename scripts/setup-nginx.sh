#!/usr/bin/env bash
#
# Publishes Chatters on one subdomain via host-level nginx, with a Let's
# Encrypt certificate, on a server that also serves other projects on other
# subdomains.
#
# The design point: nginx on the HOST owns 80/443 and routes by subdomain;
# every project (this one included) runs in Docker bound to a loopback port
# and is reached only through that proxy. Adding a project is then just
# another server block, and nothing is exposed to the internet except nginx.
#
# Only ever writes its own site file. Other projects' configs are never read,
# rewritten or reloaded out from under them, and if this project's config
# would break nginx it is removed again before reloading — a bad config here
# must not take down the other sites.
#
# Usage (as root, from the project root):
#   ./scripts/setup-nginx.sh
#
# Non-interactive:
#   DOMAIN=chat.example.com LETSENCRYPT_EMAIL=you@example.com \
#     ./scripts/setup-nginx.sh
#
# Other options:
#   STAGING=1      use Let's Encrypt staging (untrusted certs, no rate limit)
#   SKIP_CERT=1    write the HTTP config only; do not call certbot
#   RENDER_ONLY=1  print the configs to stdout and exit, changing nothing
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/lib.sh

SITE_NAME="${SITE_NAME:-chatters}"
WEBROOT="${WEBROOT:-/var/www/certbot}"
AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"

# ------------------------------------------------------------------ inputs
if [[ -f .env ]]; then
  load_env .env >/dev/null 2>&1 || true
fi

# HTTP_PORT is "127.0.0.1:8082" (or just "8082"); the proxy target is the
# port part. Chatters must be bound to loopback for this design — if it were
# on 0.0.0.0 it would be reachable from the internet directly, bypassing
# nginx and, on Ubuntu, bypassing UFW along with it.
CHAT_PORT="${CHAT_PORT:-${HTTP_PORT##*:}}"
CHAT_PORT="${CHAT_PORT:-8082}"

if [[ -z "${DOMAIN:-}" ]]; then
  read -r -p "Subdomain to serve Chatters on (e.g. chat.example.com): " DOMAIN
fi
: "${DOMAIN:?DOMAIN is required}"

if [[ "${SKIP_CERT:-0}" != "1" && "${RENDER_ONLY:-0}" != "1" && -z "${LETSENCRYPT_EMAIL:-}" ]]; then
  read -r -p "Email for Let's Encrypt expiry notices: " LETSENCRYPT_EMAIL
fi

# --------------------------------------------------------- config rendering
#
# Two configs, because of a chicken-and-egg: the HTTPS block references a
# certificate file, and nginx refuses to start if that file does not exist —
# but certbot needs a working nginx on port 80 to answer the ACME challenge
# before it can issue one. So: serve HTTP only, get the certificate, then
# rewrite with HTTPS.

# nginx gained "http2 on;" in 1.25.1; before that it was a listen parameter.
# Ubuntu 22.04 ships 1.18 and 24.04 ships 1.24, so emitting the new form
# unconditionally would fail to parse on both. Omitted entirely if the
# version cannot be determined — HTTP/2 is an optimisation, not a
# requirement, and a config that parses matters more.
http2_directive() {
  local v
  v="$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
  [[ -z "$v" ]] && return 0

  local major minor patch
  IFS=. read -r major minor patch <<< "$v"
  if (( major > 1 || (major == 1 && minor > 25) || (major == 1 && minor == 25 && patch >= 1) )); then
    echo "    http2 on;"
  else
    echo "    # http2 enabled via the listen directive below (nginx ${v})"
  fi
}

http2_listen_suffix() {
  local v
  v="$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
  [[ -z "$v" ]] && return 0

  local major minor patch
  IFS=. read -r major minor patch <<< "$v"
  if (( major > 1 || (major == 1 && minor > 25) || (major == 1 && minor == 25 && patch >= 1) )); then
    echo ""
  else
    echo " http2"
  fi
}

render_http_config() {
  cat <<EOF
# Chatters — managed by scripts/setup-nginx.sh
#
# HTTP only. Serves the ACME challenge so certbot can issue a certificate,
# and redirects everything else to HTTPS.

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
}

render_https_config() {
  local h2_listen h2_directive
  h2_listen="$(http2_listen_suffix)"
  h2_directive="$(http2_directive)"

  cat <<EOF
# Chatters — managed by scripts/setup-nginx.sh
#
# Reverse proxy to the Chatters container on 127.0.0.1:${CHAT_PORT}.
# Regenerate with: ./scripts/setup-nginx.sh

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl${h2_listen};
    listen [::]:443 ssl${h2_listen};
${h2_directive}
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    # Written out rather than included from certbot's options-ssl-nginx.conf:
    # that file ships with the python3-certbot-nginx plugin, which this setup
    # does not install (it uses the webroot challenge instead), so including
    # it would break nginx on a server where it happens not to exist.
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Keep in step with MAX_UPLOAD_BYTES in .env (20 MiB default). If this is
    # smaller, uploads fail here before ever reaching the app.
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:${CHAT_PORT};
        proxy_http_version 1.1;

        # \$http_host, not \$host: \$host silently drops a non-default port,
        # and Chatters rejects any request whose Origin disagrees with its
        # Host — so on the (unlikely but real) day this proxies a non-443
        # deployment, \$host would make every request fail that check.
        proxy_set_header Host              \$http_host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Live messaging is a WebSocket; without these it silently never
        # connects and the app looks like it just stopped receiving messages.
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";

        # Chat sockets are long-lived. The 60s default would drop them.
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF
}

if [[ "${RENDER_ONLY:-0}" == "1" ]]; then
  echo "########## phase 1: HTTP only (pre-certificate) ##########"
  render_http_config
  echo ""
  echo "########## phase 2: full HTTPS ##########"
  render_https_config
  exit 0
fi

# -------------------------------------------------------------- root check
if [[ "$(id -u)" != "0" ]]; then
  echo "==> Root is required to configure nginx; re-running with sudo"
  exec sudo -E bash "$0" "$@"
fi

# ------------------------------------------------------- port availability
#
# "Something is on 443" is two different situations with opposite fixes, so
# they are reported separately rather than as one generic failure.
echo "==> Checking ports 80 and 443"
for p in 80 443; do
  owner="$(port_owner "$p" || true)"
  if [[ -z "$owner" ]]; then
    if port_in_use "$p"; then
      echo "    Port ${p}: in use (owner unknown)"
    else
      echo "    Port ${p}: free"
    fi
    continue
  fi

  if [[ "$owner" == "nginx" ]]; then
    echo "    Port ${p}: nginx (good - this is the proxy we add a site to)"
    continue
  fi

  cat >&2 <<EOF

Error: port ${p} is held by "${owner}", not nginx.

  Host-level nginx cannot bind a port another process already has, so this
  setup cannot continue until that is resolved.

  If "${owner}" is docker-proxy, a container published that port. Almost
  certainly another project's own web server. With the host-nginx design,
  that project should also move behind the shared proxy:

    1. In that project's docker-compose.yml, change its web service from
         ports: ["80:80", "443:443"]
       to a loopback port, e.g.
         ports: ["127.0.0.1:8081:80"]
       and drop its 443 mapping.
    2. Recreate it:  docker compose up -d
    3. Give it a server block in host nginx just like this script writes for
       Chatters, proxying to 127.0.0.1:8081, and move its certificate
       handling to the host certbot.
    4. Re-run this script.

  If you would rather leave that project owning 80/443 and have IT proxy to
  Chatters instead, that is a different (also valid) layout - see DEPLOY.md,
  "Appendix C".

EOF
  exit 1
done

# --------------------------------------------------------------- packages
if ! command -v nginx >/dev/null 2>&1; then
  echo "==> Installing nginx"
  apt-get update
  apt-get install -y --no-install-recommends nginx
  systemctl enable --now nginx
else
  echo "==> nginx already installed"
fi

if [[ "${SKIP_CERT:-0}" != "1" ]] && ! command -v certbot >/dev/null 2>&1; then
  echo "==> Installing certbot"
  apt-get install -y --no-install-recommends certbot
fi

mkdir -p "$WEBROOT"

# ------------------------------------------------- install site (phase 1)
#
# Every reload is gated on `nginx -t`, and a config that fails the test is
# removed before reloading. On a server hosting several projects, a broken
# config from this script would otherwise take all of them down.
install_site() {
  local body="$1" label="$2"

  echo "==> Writing ${AVAILABLE} (${label})"
  printf '%s\n' "$body" > "$AVAILABLE"
  ln -sfn "$AVAILABLE" "$ENABLED"

  if ! nginx -t 2>&1 | sed 's/^/    /'; then
    echo "" >&2
    echo "Error: nginx rejected the ${label} config; removing it again so the" >&2
    echo "       other sites on this server keep working." >&2
    rm -f "$ENABLED"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    exit 1
  fi

  systemctl reload nginx
  echo "    nginx reloaded"
}

CERT_LIVE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [[ -f "$CERT_LIVE" ]]; then
  echo "==> Certificate for ${DOMAIN} already exists; keeping it"
  install_site "$(render_https_config)" "HTTPS"
elif [[ "${SKIP_CERT:-0}" == "1" ]]; then
  echo "==> SKIP_CERT=1; installing the HTTP-only config"
  install_site "$(render_http_config)" "HTTP only"
  echo ""
  echo "No certificate was requested. Chatters is on http://${DOMAIN} only."
  exit 0
else
  install_site "$(render_http_config)" "HTTP only, pre-certificate"

  echo ""
  echo "==> Checking ${DOMAIN} resolves to this server"
  server_ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo '')"
  domain_ip="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo '')"
  if [[ -n "$server_ip" && -n "$domain_ip" && "$server_ip" != "$domain_ip" ]]; then
    echo "    Warning: ${DOMAIN} resolves to ${domain_ip}, but this server is ${server_ip}."
    echo "    certbot will fail unless that is just DNS that has not propagated yet."
    read -r -p "    Continue anyway? [y/N] " reply
    [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 1
  else
    echo "    OK"
  fi

  STAGING_FLAG=""
  [[ "${STAGING:-0}" == "1" ]] && STAGING_FLAG="--staging"

  echo ""
  echo "==> Requesting a certificate for ${DOMAIN}"
  # --deploy-hook is recorded in this domain's renewal config, so the
  # automatic renewal certbot's package already schedules will reload nginx
  # afterwards. Without it a renewed certificate sits on disk unused until
  # something else happens to reload.
  certbot certonly --webroot -w "$WEBROOT" \
    ${STAGING_FLAG} \
    -d "$DOMAIN" \
    --email "$LETSENCRYPT_EMAIL" \
    --agree-tos --no-eff-email \
    --non-interactive \
    --deploy-hook "systemctl reload nginx"

  install_site "$(render_https_config)" "HTTPS"
fi

# ------------------------------------------------------------------ verify
echo ""
echo "==> Verifying"
if curl -fsS --max-time 10 "https://${DOMAIN}/healthz" 2>/dev/null | grep -q '"ok"'; then
  echo "    https://${DOMAIN}/healthz -> ok"
else
  echo "    Could not reach https://${DOMAIN}/healthz yet."
  echo "    If the containers are not up, start them first:  make up-prebuilt"
  echo "    Then check:  curl -sS https://${DOMAIN}/healthz"
fi

cat <<EOF

================================================================
 Chatters is served at https://${DOMAIN}

 nginx site:  ${AVAILABLE}
 proxying to: 127.0.0.1:${CHAT_PORT}
 renewal:     handled by certbot's own timer; nginx reloads via deploy-hook

 To add another project later, give it its own loopback port and its own
 server block the same way - nothing here is exclusive to Chatters.
================================================================
EOF
