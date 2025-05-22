#!/usr/bin/env bash
set -euo pipefail

#----------------- Config ------------------
: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"
export TZ="${TZ:-Asia/Singapore}"
: "${DISPLAY_BASE:=99}"                    # Starting display number for Xvfb tiers
: "${SIYUAN_FLAGS:=--no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage}"

#----------------- Helpers -----------------
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

wait_for_tcp() {                         # host port timeout
  local host=$1 port=$2 timeout=$3
  for ((i=0;i<timeout;i++)); do
    if (echo > /dev/tcp/$host/$port) &>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

ensure_dbus() {
  if [ ! -e /run/dbus ]; then
    mkdir -p /run/dbus
  fi
  if ! pgrep -x dbus-daemon >/dev/null 2>&1; then
    log "Starting dbus-daemon"
    dbus-daemon --system --address=unix:path=/run/dbus/system_bus_socket --nopidfile --fork
  fi
}

start_xvfb() {                           # displayNum
  local d=$1
  local lock="/tmp/.X${d}-lock"
  if [ -e "$lock" ]; then
    log "Removing stale X lock $lock"
    rm -f "$lock"
  fi
  log "Launching Xvfb :$d"
  Xvfb :$d -screen 0 1280x800x24 -nolisten tcp > /var/log/xvfb_$d.log 2>&1 &
  echo $!
}

launch_siyuan() {                        # additional args
  /opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" ${SIYUAN_FLAGS} "$@" &
  echo $!
}

#----------------- Tiered Startup -----------------
ensure_dbus

# Tier‑1: kernel-only binary shortcut
if [ -x /opt/siyuan/kernel ]; then
  log "Tier‑1: kernel binary detected – starting headless kernel."
  KPID=$( /opt/siyuan/kernel --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" & echo $! )
  if wait_for_tcp 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 20; then
    log "Tier‑1 live."
  else
    log "Tier‑1 failed – escalating."
    kill $KPID || true
    unset KPID
  fi
fi

# Tier‑2: Xvfb virtual display
if [ -z "${KPID:-}" ]; then
  DISP=$DISPLAY_BASE
  XV=$( start_xvfb $DISP )
  export DISPLAY=:$DISP
  KPID=$( launch_siyuan )
  if wait_for_tcp 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 30; then
    log "Tier‑2 live on display :$DISP."
  else
    log "Tier‑2 failed – escalating."
    kill $KPID || true
    kill $XV || true
    unset KPID
  fi
fi

# Tier‑3: Full WM + different display
if [ -z "${KPID:-}" ]; then
  DISP=$((DISPLAY_BASE+1))
  XV=$( start_xvfb $DISP )
  export DISPLAY=:$DISP
  fluxbox >/dev/null 2>&1 &
  KPID=$( launch_siyuan )
  if ! wait_for_tcp 127.0.0.1 "${SIYUAN_INTERNAL_PORT}" 40; then
    log "Tier‑3 failed – aborting deployment."
    tail -n 100 /var/log/xvfb_$DISP.log || true
    exit 1
  fi
  log "Tier‑3 live on display :$DISP."
fi

#----------------- Self‑tests -----------------
log "Running post‑launch tests..."

# Test 1: kernel responds to /api/ping
if curl -fsS "http://127.0.0.1:${SIYUAN_INTERNAL_PORT}/api/ping" | grep -q "pong"; then
  log "✅ Kernel ping test passed."
else
  log "❌ Kernel ping test failed."
fi

# Launch OAuth proxy (non‑blocking tests depend on it)
if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  log "Starting Discord proxy on ${PORT} → ${SIYUAN_INTERNAL_PORT}"
  node /app/discord-auth/server.js &
  PROXY=$!
else
  log "Discord credentials missing – proxy not started."
fi

# Test 2: proxy health (if started)
if [[ -n "${PROXY:-}" ]]; then
  if wait_for_tcp 127.0.0.1 "${PORT}" 10; then
    log "✅ Proxy TCP test passed (port ${PORT})."
  else
    log "❌ Proxy did not open port ${PORT}."
  fi
fi

# Tail logs for visibility
wait ${KPID}
