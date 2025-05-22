#!/usr/bin/env bash
set -euo pipefail

# Launch the SiYuan kernel in the background on the standard port (6806)
# We still set an internal auth code, but it is never exposed to the user.
# Feel free to regenerate this value – it's only used for the local proxy.
/opt/siyuan/siyuan --workspace=/siyuan/workspace --accessAuthCode=${SIYUAN_INTERNAL_CODE:-internal123} &

# Export ENV so Node can see it
export PORT=${PORT:-3000}

echo "Starting Discord OAuth proxy on port ${PORT}"
node discord-auth/server.js
