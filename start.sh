#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"
: "${SIYUAN_FLAGS:=--no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage}"
export TZ="${TZ:-Asia/Singapore}"

# Start system DBus
mkdir -p /run/dbus
dbus-daemon --system --address=unix:path=/run/dbus/system_bus_socket --fork
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
# Force Electron to use system bus for *session* too
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SYSTEM_BUS_ADDRESS}
unset DBUS_SESSION_BUS_PID

# Helper
wait_port() { for i in {1..30}; do (echo >/dev/tcp/127.0.0.1/$1) &>/dev/null && return 0; sleep 1; done; return 1; }

# Xvfb
export DISPLAY=:99
rm -f /tmp/.X99-lock || true
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" ${SIYUAN_FLAGS} &
KPID=$!
if ! wait_port "${SIYUAN_INTERNAL_PORT}"; then echo "SiYuan failed"; exit 1; fi
echo "SiYuan up."

if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  node /app/discord-auth/server.js &
  PROXY=$!
  wait $KPID $PROXY
else
  wait $KPID
fi
