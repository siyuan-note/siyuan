#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"

# Launch SiYuan kernel
/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" &
kernel_pid=$!

# Check Discord OAuth env
missing_env=0
for v in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_CALLBACK_URL; do
  if [ -z "${!v:-}" ]; then
    echo "⚠️  $v is not set. OAuth proxy will not start."
    missing_env=1
  fi
done

if [ "$missing_env" -eq 0 ]; then
  echo "Starting Discord OAuth proxy on ${PORT} → ${SIYUAN_INTERNAL_PORT}"
  node discord-auth/server.js &
  proxy_pid=$!
  wait $kernel_pid $proxy_pid
else
  echo "Waiting on SiYuan kernel (no proxy)..."
  wait $kernel_pid
fi
