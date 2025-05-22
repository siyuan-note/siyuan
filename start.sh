#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"
: "${SIYUAN_FLAGS:=--no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage}"
export TZ="${TZ:-Asia/Singapore}"

wait_for_port() {
  local host=$1 port=$2 timeout=$3
  for ((i=0;i<timeout;i++)); do
    if (echo > /dev/tcp/$host/$port) &>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

# ---- real session bus ----
if command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)"
  echo "[init] dbus session bus started at $DBUS_SESSION_BUS_ADDRESS"
fi

# Tier-0 kernel
if [ -x /opt/siyuan/kernel ]; then
  echo "[Tier-0] starting kernel binary"
  /opt/siyuan/kernel --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" &
  KPID=$!
  if wait_for_port 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 20; then
    echo "[Tier-0] kernel healthy"
  else
    kill $KPID || true
    unset KPID
  fi
fi

if [ -z "${KPID:-}" ]; then
  export DISPLAY=:99
  rm -f /tmp/.X99-lock || true
  Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
  XV=$!
  /opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" ${SIYUAN_FLAGS} &
  KPID=$!
  if ! wait_for_port 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 30; then
    echo "SiYuan failed to open port"
    exit 1
  fi
fi

echo "[init] kernel up on ${SIYUAN_INTERNAL_PORT}"

if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  node /app/discord-auth/server.js &
  PROXY=$!
  wait $KPID $PROXY
else
  wait $KPID
fi
