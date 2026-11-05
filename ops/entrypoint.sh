#!/usr/bin/env bash
# PID 1's child: boot the server, start nginx, then become the control API.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

"$OPS/boot.sh"
nginx -e stderr -c "$RUN/nginx.conf"
exec node "$GW_OPT/dist/server.js"
