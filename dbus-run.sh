#!/bin/bash
set -e

# This script is used to start the dbus daemon service
mkdir -p /var/run/dbus
dbus-daemon --system --nofork
