#!/usr/bin/env bash
# What a server does when it starts: make the directories, write the secrets file, bring the live release back, render nginx.
# Safe to run again; it is what makes `docker restart` leave the site as it was.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

mkdir -p "$RELEASES" "$RUN/tmp" "$SHARED" "$GW_ROOT/backups" "$GW_ROOT/live-config" "$GW_ROOT/sandbox-root"

# A pid file from before the restart names a process that no longer exists (or, worse, a different one).
rm -f "$RUN"/app-*.pid

# The one file the scripts read the database settings from. Owner-only, and written again on every boot so a changed
# password in .env is picked up.
if [ -n "${DATABASE_URL:-}" ]; then
  (
    umask 077
    printf 'DATABASE_URL=%q\n' "$DATABASE_URL" >"$SHARED/app.env"
  )
  chmod 600 "$SHARED/app.env"
fi

# Configuration the repository owns, and a small tree that stands in for /etc for the reversible-change toolkit.
if [ -z "$(ls -A "$GW_ROOT/live-config" 2>/dev/null)" ]; then cp -a "$GW_OPT/desired/." "$GW_ROOT/live-config/"; fi
if [ -z "$(ls -A "$GW_ROOT/sandbox-root" 2>/dev/null)" ]; then cp -a "$GW_OPT/ops/sandbox-seed/." "$GW_ROOT/sandbox-root/"; fi

"$OPS/render-nginx.sh"

# Bring the release that was live back, on the slot it was on, and point the edge at it again.
if [ -L "$GW_ROOT/current" ] && [ -f "$RUN/live-slot" ]; then
  target="$(readlink -f "$GW_ROOT/current")"
  slot="$(cat "$RUN/live-slot")"
  start_slot "$slot" "$target"
  printf 'server 127.0.0.1:%s;\n' "$slot" >"$RUN/upstream-live.conf"
  cp "$target/nginx/release.conf" "$RUN/release-snippet.conf"
  say "brought $(basename "$target") back on :$slot"
fi
