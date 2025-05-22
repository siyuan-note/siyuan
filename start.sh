#!/usr/bin/env bash
set -euo pipefail

# Defaults
: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"

# Start SiYuan kernel (headless)
/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" &

# Export for Node proxy
export PORT
export SIYUAN_INTERNAL_PORT

echo "Launching Discord OAuth proxy on ${PORT}, forwarding to kernel :${SIYUAN_INTERNAL_PORT}"
node discord-auth/server.js
