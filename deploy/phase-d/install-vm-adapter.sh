#!/bin/sh
set -eu
install -d -m 0755 /opt/hermes/bin
install -m 0755 "$(dirname "$0")/win-cua-mcp.py" /opt/hermes/bin/win-cua-mcp
install -d -m 0700 /etc/hermes
if [ ! -f /etc/hermes/phase-d.secret ]; then
  umask 077
  python3 -c 'import secrets;print(secrets.token_hex(32))' > /etc/hermes/phase-d.secret
fi
chmod 0600 /etc/hermes/phase-d.secret
printf '%s\n' 'Set HERMES_CUA_DRIVER_CMD=/opt/hermes/bin/win-cua-mcp in the Hermes service environment, then restart Hermes.'
