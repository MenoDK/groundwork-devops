# shellcheck shell=bash
# Sourced by stage.sh. Its check asks the service whether it is still well after the change; in the sandbox the service
# is a file, and the lab can make that file say "bad" to show a stage undoing itself.
# shellcheck disable=SC2034  # read by stage.sh, which sources this file
title="core dumps off, and the service must still be healthy"

apply() {
  keep etc/security/limits.conf || return 1
  printf '*    hard    core      0\n' >>"$ROOT/etc/security/limits.conf" || return 1
}

verify() {
  grep -qx '\*    hard    core      0' "$ROOT/etc/security/limits.conf" || { echo "the limit is not in place"; return 1; }
  [ "$(cat "$ROOT/var/lib/service-health" 2>/dev/null)" = "ok" ] || { echo "the service reports $(cat "$ROOT/var/lib/service-health" 2>/dev/null || echo nothing) after the change"; return 1; }
}
