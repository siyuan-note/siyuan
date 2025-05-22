#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"

# SiYuan Electron needs --no-sandbox when running as root
/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" --no-sandbox &
kernel_pid=$!

missing_env=0
for v in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_CALLBACK_URL; do
  [[ -z "${!v:-}" ]] && missing_env=1
done

if [ "$missing_env" -eq 0 ]; then
  echo "Starting Discord OAuth proxy on ${PORT} -> ${SIYUAN_INTERNAL_PORT}"
  node discord-auth/server.js &
  proxy_pid=$!
  wait $kernel_pid $proxy_pid
else
  echo "Proxy disabled (Discord creds missing). Serving kernel only."
  wait $kernel_pid
fi
