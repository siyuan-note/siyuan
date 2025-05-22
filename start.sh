#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"

/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" &

export PORT
export SIYUAN_INTERNAL_PORT

echo "Starting Discord OAuth proxy on ${PORT} -> ${SIYUAN_INTERNAL_PORT}"
node discord-auth/server.js
