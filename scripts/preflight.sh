#!/usr/bin/env bash
#
# Run before `docker compose up` (make up / make up-prebuilt). Catches the two
# ways the frontend's host port goes wrong on a server shared with other
# projects, both of which otherwise surface only as Docker's
# "Bind for 127.0.0.1:8082 failed: port is already allocated":
#
#   1. HTTP_PORT is exported in the shell. A shell variable beats .env, so
#      editing .env appears to do nothing. The Makefile starts compose with
#      HTTP_PORT unset so .env wins; this only tells you it happened.
#
#   2. The port in .env is taken by something that is not this stack (another
#      project's container, or a native service). Rather than fail, pick the
#      next free port and write it to .env, then say what else has to follow.
#
# Idempotent: when the port is free, or already held by this stack's own
# frontend (which compose is about to recreate), it changes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source scripts/lib.sh

[[ -f .env ]] || exit 0

DEFAULT_HTTP_PORT="127.0.0.1:8082" # keep in step with docker-compose.yml

env_value() {
  local v
  v="$(grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

file_value="$(env_value HTTP_PORT)"
effective="${file_value:-$DEFAULT_HTTP_PORT}"

# --- 1. shell variable shadowing .env ---------------------------------------
if [[ -n "${HTTP_PORT:-}" && "${HTTP_PORT}" != "$effective" ]]; then
  echo "Note: HTTP_PORT=${HTTP_PORT} is exported in your shell and differs from" >&2
  echo "      .env (${effective}). It is ignored here so .env wins. To stop seeing" >&2
  echo "      this, run 'unset HTTP_PORT' and remove any export of it from your" >&2
  echo "      shell profile (grep -n HTTP_PORT ~/.bashrc ~/.profile)." >&2
fi

port="${effective##*:}"
host=""
[[ "$effective" == *:* ]] && host="${effective%:*}"

if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "Error: HTTP_PORT in .env is not a port: '${effective}'" >&2
  exit 1
fi

# --- 2. port already taken by something else --------------------------------
port_in_use "$port" || exit 0

holder="$(docker ps --filter "publish=${port}" --format '{{.ID}} {{.Names}}' 2>/dev/null | head -1 || true)"
holder_id="${holder%% *}"
holder_name="${holder#* }"

# Ours: the frontend container of this compose project. Leave it alone;
# `up` recreates it and releases the port itself.
ours="$(docker compose ps -q frontend 2>/dev/null || true)"
if [[ -n "$holder_id" && -n "$ours" && "$ours" == "$holder_id"* ]]; then
  exit 0
fi

owner="${holder_name:-$(port_owner "$port")}"
owner="${owner:-another process}"

new_port="$(find_free_port $((port + 1)))"
new_value="${host:+${host}:}${new_port}"

echo "Port ${port} is already in use by ${owner}; Chatters cannot bind it." >&2
echo "Switching Chatters to ${new_value} in .env." >&2

if grep -qE '^HTTP_PORT=' .env; then
  sed -i "s|^HTTP_PORT=.*|HTTP_PORT=${new_value}|" .env
else
  printf '\nHTTP_PORT=%s\n' "$new_value" >> .env
fi

echo "" >&2
echo "The public site still points at the old port. Update the host nginx to" >&2
echo "proxy to 127.0.0.1:${new_port}: run 'make nginx' (or edit its proxy_pass" >&2
echo "by hand) and reload nginx." >&2
