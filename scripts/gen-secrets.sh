#!/usr/bin/env bash
#
# Fills the generated secrets in .env. Existing non-empty values are left
# alone, so this is safe to re-run and will never rotate a key that is already
# protecting live data.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found. Run 'make env' first." >&2
  exit 1
fi

# set_if_empty KEY VALUE — assign only when the key is missing or blank.
set_if_empty() {
  local key="$1" value="$2"

  if grep -qE "^${key}=.+$" .env; then
    echo "  ${key} already set, leaving it alone"
    return
  fi

  if grep -qE "^${key}=" .env; then
    # Portable in-place edit: BSD and GNU sed disagree about -i.
    sed "s|^${key}=.*|${key}=${value}|" .env > .env.tmp && mv .env.tmp .env
  else
    echo "${key}=${value}" >> .env
  fi
  echo "  ${key} generated"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-64
  else
    head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

echo "Filling secrets in .env"
set_if_empty JWT_SECRET "$(random_secret)"

# VAPID keys need the Go toolchain; skip rather than fail if it is absent,
# since push notifications are optional.
if command -v go >/dev/null 2>&1; then
  if grep -qE '^VAPID_PUBLIC_KEY=.+$' .env; then
    echo "  VAPID keys already set, leaving them alone"
  else
    vapid_output="$(cd Chatters && go run ./cmd/vapid)"
    set_if_empty VAPID_PUBLIC_KEY "$(echo "$vapid_output" | grep '^VAPID_PUBLIC_KEY=' | cut -d= -f2-)"
    set_if_empty VAPID_PRIVATE_KEY "$(echo "$vapid_output" | grep '^VAPID_PRIVATE_KEY=' | cut -d= -f2-)"
  fi
else
  echo "  Go not found — skipping VAPID keys (push notifications stay disabled)"
fi

echo
echo "Done. Review .env and set ADMIN_USERNAME / ADMIN_PASSWORD before deploying."
