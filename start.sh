#!/usr/bin/env bash
set -euo pipefail

: "${PORT:=6806}"
: "${SIYUAN_INTERNAL_PORT:=6807}"
: "${SIYUAN_ACCESS_AUTH_CODE:=changeme}"

run_kernel_only() {
  if [ -x /opt/siyuan/kernel ]; then
    echo "[Tier‑1] Kernel‑only mode – launching /opt/siyuan/kernel"
    /opt/siyuan/kernel --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" &
    KPID=$!
    sleep 6
    if kill -0 "$KPID" 2>/dev/null; then
      echo "[Tier‑1] Kernel‑only mode is healthy."
      wait "$KPID"
      exit 0
    else
      echo "[Tier‑1] Kernel‑only failed – escalating to Tier‑2."
      return 1
    fi
  else
    echo "[Tier‑1] Kernel binary not present."
    return 1
  fi
}

run_xvfb() {
  echo "[Tier‑2] Starting Xvfb virtual display..."
  export DISPLAY=:99
  Xvfb :99 -screen 0 1024x768x16 &
  XV=$!
  dbus-daemon --system --fork || true
  /opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" --no-sandbox &
  SPID=$!
  sleep 10
  if kill -0 "$SPID" 2>/dev/null; then
    echo "[Tier‑2] Electron is healthy under Xvfb."
    wait "$SPID"
    return 0
  else
    echo "[Tier‑2] Xvfb attempt failed – escalating to Tier‑3."
    kill "$XV" || true
    return 1
  fi
}

run_full_stack() {
  echo "[Tier‑3] Starting full dummy X session..."
  export DISPLAY=:0
  Xvfb :0 -screen 0 1280x800x24 &
  XV=$!
  fluxbox > /dev/null 2>&1 &
  dbus-daemon --system --fork || true
  /opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE}" --port="${SIYUAN_INTERNAL_PORT}" --no-sandbox &
  wait $!
}

# Kick off tiers sequentially
run_kernel_only || run_xvfb || run_full_stack &
KERNEL_WRAPPER_PID=$!

# --- OAuth proxy if creds exist ---
if [[ -n "${DISCORD_CLIENT_ID:-}" && -n "${DISCORD_CLIENT_SECRET:-}" && -n "${DISCORD_CALLBACK_URL:-}" ]]; then
  echo "Starting Discord OAuth proxy on ${PORT} → ${SIYUAN_INTERNAL_PORT}"
  node /app/discord-auth/server.js &
  PROXY_PID=$!
  wait $KERNEL_WRAPPER_PID $PROXY_PID
else
  echo "Discord vars missing – OAuth proxy disabled."
  wait $KERNEL_WRAPPER_PID
fi
