#!/usr/bin/env bash
# Stops or restarts the release that is serving, without touching what the deploy recorded. It exists for the lab: a
# process that dies is the most ordinary incident there is, and the alerting has to notice it.
#
#   app-ctl.sh stop     kill the live release's process (the edge answers 502 from then on)
#   app-ctl.sh start    start the current release again on its slot
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

if [ ! -f "$RUN/live-slot" ] || [ ! -L "$GW_ROOT/current" ]; then
  result_line false app refused "there is no live release"
  echo "x there is no live release"
  exit 1
fi
slot="$(cat "$RUN/live-slot")"
case "${1:-}" in
  stop)
    stop_slot "$slot"
    event "$(basename "$(readlink -f "$GW_ROOT/current")")" "process" "refused" "the live process was stopped"
    result_line true app stopped "the live release stopped answering"
    ;;
  start)
    stop_slot "$slot"
    start_slot "$slot" "$(readlink -f "$GW_ROOT/current")"
    result_line true app started "the live release was started again"
    ;;
  *)
    echo "usage: app-ctl.sh stop | start" >&2
    exit 2
    ;;
esac
