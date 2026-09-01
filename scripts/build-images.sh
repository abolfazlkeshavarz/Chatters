#!/usr/bin/env bash
#
# Builds the Chatters images HERE (a development machine) and packs them into
# a single tarball to carry to the server, so the server never has to compile
# anything.
#
# Why this exists: the frontend's JavaScript build wants roughly 1.5 GB of RAM
# and the Go build is CPU-bound. On a small VPS — 1 core, little memory —
# building in place is slow at best and gets OOM-killed at worst. Building
# where the resources are and shipping the result sidesteps that entirely.
#
# Usage (on your own machine, from the project root):
#   ./scripts/build-images.sh
#
# Options (environment variables):
#   PLATFORM=linux/arm64   target architecture, if the server is not x86-64
#   INCLUDE_BASE=1         also bundle postgres/redis, for a server that
#                          cannot pull from Docker Hub at all
#   OUT=path/to/file.tar.gz   where to write the bundle
set -euo pipefail

cd "$(dirname "$0")/.."

PLATFORM="${PLATFORM:-linux/amd64}"
OUT="${OUT:-dist/chatters-images.tar.gz}"
INCLUDE_BASE="${INCLUDE_BASE:-0}"

# Read from the compose file rather than hardcoded, so these stay correct if
# the base image versions there are ever bumped.
BASE_IMAGES=(postgres:16-alpine redis:7-alpine)

IMAGES=(chatters-backend:latest chatters-frontend:latest)

echo "==> Building images for ${PLATFORM}"
echo ""

# A .env has to exist for compose to interpolate the file at all (JWT_SECRET
# is declared required). Its *values* are irrelevant to a build — they are
# runtime settings, and none of them are baked into the images — so a
# throwaway one is fine and is cleaned up afterwards, rather than making the
# operator create a real .env on a machine that will never run the stack.
TEMP_ENV=0
if [[ ! -f .env ]]; then
  TEMP_ENV=1
  cp .env.example .env
  # Only needs to be non-empty to satisfy the "required variable" check.
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=build-time-placeholder-not-used-at-runtime|" .env && rm -f .env.bak
  echo "    (using a temporary .env just to satisfy compose interpolation;"
  echo "     build args aside, nothing from it is baked into the images)"
  echo ""
fi
cleanup() { [[ "$TEMP_ENV" == "1" ]] && rm -f .env; }
trap cleanup EXIT

DOCKER_DEFAULT_PLATFORM="$PLATFORM" docker compose build

echo ""
echo "==> Verifying the built images really are ${PLATFORM}"
# Worth checking rather than assuming: a mismatch here does not fail the
# build, it produces images that load fine on the server and then die at
# startup with a bare "exec format error" — a genuinely confusing symptom to
# debug remotely. Cheaper to catch it now.
want_os="${PLATFORM%%/*}"
want_arch="${PLATFORM##*/}"
for img in "${IMAGES[@]}"; do
  got="$(docker image inspect "$img" --format '{{.Os}}/{{.Architecture}}')"
  if [[ "$got" != "${want_os}/${want_arch}" ]]; then
    echo "Error: ${img} is ${got}, but ${PLATFORM} was requested." >&2
    echo "       Loading this on the server would fail at runtime with" >&2
    echo "       \"exec format error\". Check your Docker buildx setup." >&2
    exit 1
  fi
  echo "    ${img}: ${got}"
done

if [[ "$INCLUDE_BASE" == "1" ]]; then
  echo ""
  echo "==> Also pulling base images for ${PLATFORM} (INCLUDE_BASE=1)"
  for img in "${BASE_IMAGES[@]}"; do
    docker pull --platform "$PLATFORM" "$img"
  done
  IMAGES+=("${BASE_IMAGES[@]}")
fi

echo ""
echo "==> Packing into ${OUT}"
mkdir -p "$(dirname "$OUT")"
# gzip -1: these layers are mostly already-compressed content, so the higher
# levels cost a lot of time for very little extra saving.
docker save "${IMAGES[@]}" | gzip -1 > "$OUT"

size="$(du -h "$OUT" | cut -f1)"
echo ""
echo "================================================================"
echo " Built: ${size}  ->  ${OUT}"
echo "================================================================"
echo ""
echo "Next, copy it to the server and load it there:"
echo ""
echo "  scp ${OUT} YOUR_USER@YOUR_SERVER:/opt/chatters/"
echo "  ssh YOUR_USER@YOUR_SERVER"
echo "  cd /opt/chatters && ./scripts/load-images.sh"
echo ""
if [[ "$INCLUDE_BASE" != "1" ]]; then
  echo "This bundle contains only the two images that must be built."
  echo "postgres and redis are pulled from Docker Hub on the server — note that"
  echo "postgres:16-alpine is very likely already present there if another"
  echo "project uses it. If the server cannot reach Docker Hub at all, rebuild"
  echo "the bundle with INCLUDE_BASE=1 to bundle those too."
  echo ""
fi
