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

# Web Push (VAPID) keys.
#
# Two ways to mint these, because the server usually cannot do it the obvious
# way: the recommended deployment ships prebuilt images to a machine with no
# Go toolchain. This used to silently skip key generation there, which left
# push notifications impossible to enable on exactly the servers the
# deployment guide steers people towards. So fall back to the backend image,
# which carries the same generator behind `-vapid`.
generate_vapid() {
  if command -v go >/dev/null 2>&1; then
    (cd Chatters && go run ./cmd/server -vapid) 2>/dev/null && return 0
  fi

  # The image's ENTRYPOINT is already the server binary, so the flag is just
  # appended — no --entrypoint override needed.
  if command -v docker >/dev/null 2>&1 \
     && docker image inspect chatters-backend:latest >/dev/null 2>&1; then
    docker run --rm chatters-backend:latest -vapid 2>/dev/null && return 0
  fi

  return 1
}

if grep -qE '^VAPID_PUBLIC_KEY=.+$' .env; then
  echo "  VAPID keys already set, leaving them alone"
elif vapid_output="$(generate_vapid)"; then
  set_if_empty VAPID_PUBLIC_KEY "$(echo "$vapid_output" | grep '^VAPID_PUBLIC_KEY=' | cut -d= -f2-)"
  set_if_empty VAPID_PRIVATE_KEY "$(echo "$vapid_output" | grep '^VAPID_PRIVATE_KEY=' | cut -d= -f2-)"
else
  echo "  WARNING: could not generate VAPID keys - push notifications will be"
  echo "           disabled, and cannot be enabled from the app until they are set."
  echo "           Needs either the Go toolchain, or the backend image present"
  echo "           (load it first: ./scripts/load-images.sh), then re-run:"
  echo "               bash scripts/gen-secrets.sh"
fi

echo
echo "Done. Review .env and set ADMIN_USERNAME / ADMIN_PASSWORD before deploying."
