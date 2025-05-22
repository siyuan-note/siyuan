#!/usr/bin/env bash
set -euo pipefail

# ===== Config vars =====
: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"
: "${SIYUAN_FLAGS:=--no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage}"

wait_for_port () {
  local host=$1
  local port=$2
  local max=${3:-30}
  local count=0
  while ! (echo > /dev/tcp/$host/$port) >/dev/null 2>&1; do
    sleep 1
    count=$((count+1))
    if [ $count -ge $max ]; then
      return 1
    fi
  done
  return 0
}

start_dbus () {
  if ! pgrep -x dbus-daemon >/dev/null 2>&1; then
    echo "[init] starting system dbus-daemon"
    dbus-daemon --system --address=unix:path=/run/dbus/system_bus_socket --fork
  fi
}

# ---------- Tier 1 : Direct headless (possible future kernel) ----------
if [ -x /opt/siyuan/kernel ]; then
  echo "[Tier-1] Running SiYuan kernel-only binary..."
  /opt/siyuan/kernel --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" &
  PID=$!
  if wait_for_port 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 20; then
    echo "[Tier-1] Kernel ready on :${SIYUAN_INTERNAL_PORT}"
  else
    echo "[Tier-1] Port check failed – escalating."
    kill $PID || true
    unset PID
  fi
fi

# ---------- Tier 2 : Electron under Xvfb ----------
if [ -z "${PID:-}" ]; then
  echo "[Tier-2] Starting Xvfb virtual display..."
  export DISPLAY=:99
  Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
  XV=$!
  start_dbus
  echo "[Tier-2] Launching Electron app with safe flags."
  /opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" ${SIYUAN_FLAGS} &
  PID=$!
  if wait_for_port 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 30; then
    echo "[Tier-2] Kernel is up via Electron+Xvfb."
  else
    echo "[Tier-2] Failed to detect port – escalating."
    kill $PID || true
    kill $XV || true
    unset PID
  fi
fi

# ---------- Tier 3 : Full FVWM/Fluxbox + Xvfb ----------
if [ -z "${PID:-}" ]; then
  echo "[Tier-3] Launching full lightweight window manager inside Xvfb."
  export DISPLAY=:0
  Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
  XV=$!
  fluxbox >/dev/null 2>&1 &
  start_dbus
  /opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" ${SIYUAN_FLAGS} &
  PID=$!
  if ! wait_for_port 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 40; then
    echo "[Tier-3] SiYuan failed even under full X. Exiting."
    exit 1
  fi
  echo "[Tier-3] Kernel available."
fi

# ---------- Start OAuth proxy ----------
if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  echo "Starting Discord OAuth proxy on ${PORT} -> ${SIYUAN_INTERNAL_PORT}"
  node /app/discord-auth/server.js &
  PROXY=$!
  wait $PID $PROXY
else
  echo "[init] Discord env vars missing – proxy disabled."
  wait $PID
fi
