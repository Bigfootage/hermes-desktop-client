#!/bin/sh
set -eu
install -d -m 0755 /opt/hermes/bin
install -m 0755 "$(dirname "$0")/win-cua-mcp.py" /opt/hermes/bin/win-cua-mcp
printf '%s\n' 'Set HERMES_CUA_DRIVER_CMD=/opt/hermes/bin/win-cua-mcp and HERMES_API_KEY in the same root-readable Hermes service environment, then restart Hermes.'
