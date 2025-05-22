#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"
: "${SIYUAN_FLAGS:=--no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage}"
export TZ="${TZ:-Asia/Singapore}"

# 1. Start system dbus
if [ ! -S /run/dbus/system_bus_socket ]; then
  mkdir -p /run/dbus
  dbus-daemon --system --address=unix:path=/run/dbus/system_bus_socket --fork
  echo "[init] system bus ready."
fi
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket

# 2. Start session dbus
if command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)"
  echo "[init] session bus ready at $DBUS_SESSION_BUS_ADDRESS"
fi

wait_port() {
  local port=$1
  for i in {1..30}; do
    (echo >/dev/tcp/127.0.0.1/$port) >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# 3. Xvfb + SiYuan
export DISPLAY=:99
rm -f /tmp/.X99-lock || true
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" ${SIYUAN_FLAGS} &
KPID=$!

if ! wait_port "${SIYUAN_INTERNAL_PORT}"; then
  echo "❌ SiYuan failed to start"
  exit 1
fi
echo "✅ SiYuan listening on ${SIYUAN_INTERNAL_PORT}"

# 4. Discord proxy
if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  node /app/discord-auth/server.js &
  PROXY=$!
  echo "✅ Proxy listening on ${PORT}"
  wait $KPID $PROXY
else
  echo "⚠️  Proxy disabled – missing Discord env vars"
  wait $KPID
fi
