#!/usr/bin/env bash
set -euo pipefail

# INTERNAL PORT for SiYuan kernel so it doesn't collide with external PORT
export SIYUAN_INTERNAL_PORT=${SIYUAN_INTERNAL_PORT:-6807}

# Launch SiYuan headless kernel
/opt/siyuan/siyuan --workspace=/siyuan/workspace \
    --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE:-internal123}" \
    --port=${SIYUAN_INTERNAL_PORT} &

# If Railway injects PORT (e.g., 6806) we'll use it, else default 3000
export PORT=${PORT:-3000}

echo "Starting Discord OAuth proxy on port ${PORT}"
node discord-auth/server.js
