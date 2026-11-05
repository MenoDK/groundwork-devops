#!/usr/bin/env bash
# Writes run/nginx.conf from the template and makes sure the include files exist, so a first start has something to load.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

mkdir -p "$RUN/tmp"
sed -e "s|__RUN__|$RUN|g" -e "s|__EDGE_PORT__|$GW_EDGE_PORT|g" -e "s|__CONTROL_PORT__|$GW_CONTROL_PORT|g" \
  "$GW_OPT/nginx/nginx.conf.template" >"$RUN/nginx.conf"

# Before the first release there is nothing to point at; 127.0.0.1:1 refuses at once, so /app/ answers 502 instead of hanging.
[ -f "$RUN/upstream-live.conf" ] || echo 'server 127.0.0.1:1;' >"$RUN/upstream-live.conf"
[ -f "$RUN/release-snippet.conf" ] || echo '# no release yet' >"$RUN/release-snippet.conf"
nginx -e stderr -c "$RUN/nginx.conf" -t >/dev/null 2>&1 || { nginx -e stderr -c "$RUN/nginx.conf" -t >&2; exit 1; }
