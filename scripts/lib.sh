#!/usr/bin/env bash
#
# Shared helpers sourced by other scripts (and by the Makefile). Not meant to
# be run directly.

# ---------------------------------------------------------------------------
# load_env <file>
#
# Loads a .env-style file WITHOUT using `source`/`.`, which executes every
# line as a shell command. A stray line that isn't a comment or a KEY=VALUE
# assignment would otherwise be run as a command and crash with "command not
# found". This only exports well-formed KEY=VALUE lines and warns (without
# aborting) about anything else.
# ---------------------------------------------------------------------------
load_env() {
  local file="${1:-.env}"
  if [[ ! -f "$file" ]]; then
    echo "Error: $file not found." >&2
    return 1
  fi
  set -a
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    else
      echo "Warning: ignoring malformed line in $file: $line" >&2
    fi
  done < "$file"
  set +a
}

# ---------------------------------------------------------------------------
# port_in_use <port>
#
# True if something — any process, ours or not, containerised or not — is
# already listening on this host port. This is the actual question that
# matters on a server that runs other projects: docker-proxy publishes ports
# by binding them at the OS level same as any other process, so a container
# from a completely unrelated docker-compose project is just as much a
# collision as a native service would be, and "ss" sees both the same way.
#
# ss (iproute2) is a base package on every Ubuntu/Debian install this script
# targets, so it is trusted as the primary check rather than juggling several
# tools' incompatible flag dialects — netstat in particular is not one
# command: BSD, GNU net-tools and Windows netstat all accept different flags
# for the same query, and picking the wrong one doesn't error, it silently
# prints something else (verified: Windows netstat -tln prints its own usage
# text instead of failing, which would have made this check silently always
# report "free"). Falls back to a raw connect attempt only if ss is somehow
# missing, which would be unusual on a real Ubuntu/Debian server.
# ---------------------------------------------------------------------------
port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -Htln "( sport = :$port )" 2>/dev/null | grep -q .
    return $?
  fi

  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { exec 3>&-; return 0; }
  return 1
}

# ---------------------------------------------------------------------------
# find_free_port <start>
#
# First free port at or above <start>. Used to pick a localhost-only port for
# the frontend container when 80/443 already belong to something else, so
# deployment can proceed automatically instead of failing on "port is already
# allocated" and leaving the operator to guess a number by hand.
# ---------------------------------------------------------------------------
find_free_port() {
  local port="${1:-8091}"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}
