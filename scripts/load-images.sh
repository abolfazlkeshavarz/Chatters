#!/usr/bin/env bash
#
# Loads the image bundle produced by build-images.sh on your own machine.
# Run this ON THE SERVER, after copying the tarball across.
#
# Usage (from the project root on the server):
#   ./scripts/load-images.sh [path/to/chatters-images.tar.gz]
#
# Defaults to looking for the bundle in the project root and in dist/.
set -euo pipefail

cd "$(dirname "$0")/.."

BUNDLE="${1:-}"
if [[ -z "$BUNDLE" ]]; then
  for candidate in chatters-images.tar.gz dist/chatters-images.tar.gz; do
    if [[ -f "$candidate" ]]; then
      BUNDLE="$candidate"
      break
    fi
  done
fi

if [[ -z "$BUNDLE" || ! -f "$BUNDLE" ]]; then
  echo "Error: image bundle not found." >&2
  echo "" >&2
  echo "Build it on your own machine first:" >&2
  echo "    ./scripts/build-images.sh" >&2
  echo "then copy it here:" >&2
  echo "    scp dist/chatters-images.tar.gz USER@THIS_SERVER:$(pwd)/" >&2
  exit 1
fi

echo "==> Loading images from ${BUNDLE}"
gunzip -c "$BUNDLE" | docker load

echo ""
echo "==> Checking the images match this machine's architecture"
# Same reasoning as the check in build-images.sh, from the other end: an
# architecture mismatch loads perfectly happily and only fails later, at
# container start, with an opaque "exec format error".
host_arch="$(docker info --format '{{.Architecture}}' 2>/dev/null || uname -m)"
case "$host_arch" in
  x86_64|amd64)   host_arch=amd64 ;;
  aarch64|arm64)  host_arch=arm64 ;;
esac

for img in chatters-backend:latest chatters-frontend:latest; do
  got="$(docker image inspect "$img" --format '{{.Architecture}}' 2>/dev/null || echo missing)"
  if [[ "$got" == "missing" ]]; then
    echo "Error: ${img} is not present after loading the bundle." >&2
    exit 1
  fi
  if [[ "$got" != "$host_arch" ]]; then
    echo "" >&2
    echo "Error: ${img} is ${got}, but this server is ${host_arch}." >&2
    echo "       It would start and immediately fail with \"exec format error\"." >&2
    echo "       Rebuild the bundle for the right architecture:" >&2
    echo "           PLATFORM=linux/${host_arch} ./scripts/build-images.sh" >&2
    exit 1
  fi
  echo "    ${img}: ${got} - matches this server"
done

echo ""
echo "Images loaded. Start the stack without building:"
echo "    make up-prebuilt"
echo ""
echo "Or, if this is a first-time setup that still needs .env and port checks:"
echo "    ./scripts/bootstrap-vps.sh"
echo "    (it detects the loaded images and skips the build step automatically)"
