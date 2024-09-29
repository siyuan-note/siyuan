#!/bin/sh
set -e

# Default values
PUID=${PUID:-1000}
PGID=${PGID:-1000}
USER_NAME=${USER_NAME:-siyuan}
GROUP_NAME=${GROUP_NAME:-siyuan}

# Get or create group
group_name="${GROUP_NAME}"
if getent group "${PGID}" > /dev/null 2>&1; then
    group_name=$(getent group "${PGID}" | cut -d: -f1)
    echo "Using existing group: ${group_name} (${PGID})"
else
    echo "Creating group ${group_name} (${PGID})"
    addgroup --gid "${PGID}" "${group_name}"
fi

# Get or create user
user_name="${USER_NAME}"
if id -u "${PUID}" > /dev/null 2>&1; then
    user_name=$(getent passwd "${PUID}" | cut -d: -f1)
    echo "Using existing user ${user_name} (PUID: ${PUID}, PGID: ${PGID})"
else
    echo "Creating user ${user_name} (PUID: ${PUID}, PGID: ${PGID})"
    adduser --uid "${PUID}" --ingroup "${group_name}" --disabled-password --gecos "" "${user_name}"
fi

# Change ownership of relevant directories
echo "Adjusting ownership of /opt/siyuan and /home/siyuan/"
chown -R "${PUID}:${PGID}" /opt/siyuan
chown -R "${PUID}:${PGID}" /home/siyuan/

# Switch to the newly created user and start the main process
echo "Starting Siyuan with UID:${PUID} and GID:${PGID}"
exec su-exec "${PUID}:${PGID}" /opt/siyuan/kernel "$@"