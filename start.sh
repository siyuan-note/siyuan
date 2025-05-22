#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"
: "${SIYUAN_FLAGS:=--no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage}"
export TZ="${TZ:-Asia/Singapore}"

# --------------------------------------------------------------------
# Prepare /run/dbus directory and clean stale PID/socket
# --------------------------------------------------------------------
mkdir -p /run/dbus
if [ -e /run/dbus/pid ] && ! pgrep -F /run/dbus/pid >/dev/null 2>&1; then
  echo "[dbus] Removing stale pid file"
  rm -f /run/dbus/pid
fi
if [ -S /run/dbus/system_bus_socket ] && ! ss -lx | grep -q system_bus_socket; then
  echo "[dbus] Removing stale system_bus_socket"
  rm -f /run/dbus/system_bus_socket
fi

# --------------------------------------------------------------------
# Start system bus if not active
# --------------------------------------------------------------------
if ! ss -lx | grep -q system_bus_socket; then
  dbus-daemon --system --address=unix:path=/run/dbus/system_bus_socket --pidfile=/run/dbus/pid --fork
  echo "[dbus] system bus launched (PID $(cat /run/dbus/pid))"
else
  echo "[dbus] system bus already running"
fi
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
# Point session bus to system bus to bypass autolaunch
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SYSTEM_BUS_ADDRESS}
unset DBUS_SESSION_BUS_PID

# Helper to wait for TCP port
wait_port() { for i in {1..30}; do (echo >/dev/tcp/127.0.0.1/$1) &>/dev/null && return 0; sleep 1; done; return 1; }

# --------------------------------------------------------------------
# Launch Xvfb display
# --------------------------------------------------------------------
export DISPLAY=:99
rm -f /tmp/.X99-lock || true
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
XV=$!
echo "[xvfb] Virtual display :99 up (PID $XV)"

# --------------------------------------------------------------------
# Start SiYuan
# --------------------------------------------------------------------
/opt/siyuan/siyuan       --workspace=/siyuan/workspace       --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}"       --port="${SIYUAN_INTERNAL_PORT}"       ${SIYUAN_FLAGS} &
KPID=$!
echo "[siyuan] Launched (PID $KPID)"

if ! wait_port "${SIYUAN_INTERNAL_PORT}"; then
  echo "❌ SiYuan failed to listen on ${SIYUAN_INTERNAL_PORT}"
  tail -n 100 /var/log/xvfb.log || true
  exit 1
fi
echo "✅ SiYuan kernel listening on ${SIYUAN_INTERNAL_PORT}"

# --------------------------------------------------------------------
# Launch Discord OAuth proxy
# --------------------------------------------------------------------
if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  node /app/discord-auth/server.js &
  PROXY=$!
  echo "✅ Proxy listening on ${PORT} (PID $PROXY)"
  wait $KPID $PROXY
else
  echo "⚠️  Discord env vars missing – proxy not started"
  wait $KPID
fi
