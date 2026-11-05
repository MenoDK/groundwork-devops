# shellcheck shell=bash
# shellcheck disable=SC2034  # the variables below are read by the scripts that source this file
# Shared by every script in ops/: where things live, one JSON event per decision, and the last line every script prints.
#
# Every path and port can be overridden, which is how the tests run a complete second "server" next to the real one.

GW_ROOT="${GW_ROOT:-/srv/groundwork}"
GW_OPT="${GW_OPT:-/opt/groundwork}"
GW_EDGE_PORT="${GW_EDGE_PORT:-8080}"
GW_CONTROL_PORT="${GW_CONTROL_PORT:-3000}"
GW_SLOT_A="${GW_SLOT_A:-4101}"
GW_SLOT_B="${GW_SLOT_B:-4102}"
GW_KEEP="${GW_KEEP:-3}"
GW_HEALTH_TIMEOUT="${GW_HEALTH_TIMEOUT:-20}"
GW_DRAIN="${GW_DRAIN:-1}"
export GW_ROOT GW_OPT GW_EDGE_PORT GW_CONTROL_PORT GW_SLOT_A GW_SLOT_B GW_KEEP GW_HEALTH_TIMEOUT GW_DRAIN

RELEASES="$GW_ROOT/releases"
RUN="$GW_ROOT/run"
SHARED="$GW_ROOT/shared"
EVENTS="$GW_ROOT/deploy-log.jsonl"
OPS="$GW_OPT/ops"

say() { printf '%s\n' "$*"; }

# One line of history per decision: what was shipped, which gate spoke, and what happened.
# release gate result reason   (result: shipped | refused | rolled_back)
event() {
  mkdir -p "$GW_ROOT"
  jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg release "$1" --arg gate "$2" --arg result "$3" --arg reason "$4" \
    '{ts: $ts, release: $release, gate: $gate, result: $result, reason: $reason}' >>"$EVENTS"
}

# The machine-readable last line. The control API reads this and nothing else.
# ok gate result message [release] [detail-json]
result_line() {
  printf 'RESULT %s\n' "$(jq -cn --argjson ok "$1" --arg gate "$2" --arg result "$3" --arg message "$4" --arg release "${5:-}" \
    --argjson detail "${6:-null}" \
    '{ok: $ok, gate: $gate, result: $result, message: $message, release: $release, detail: $detail}')"
}

# The database settings live in one file with mode 600; scripts read them here and nowhere else.
load_env() {
  [ -f "$SHARED/app.env" ] || return 1
  set -a
  # shellcheck disable=SC1091
  . "$SHARED/app.env"
  set +a
}

# Stops the release process on a slot (a pid file, then a bounded wait, then no mercy).
stop_slot() {
  local file="$RUN/app-$1.pid" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file")"
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$file"
}

# Starts a release on a slot, detached from whoever called us so that a restart of the API does not stop the site.
#
# `9>&-` matters: deploy.sh holds its lock on file descriptor 9, and a child inherits every descriptor. A release that
# kept the lock open would block every later deploy for as long as it lived (found by the tests, not by reading).
start_slot() {
  local port="$1" dir="$2"
  (
    cd "$dir" || exit 1
    PORT="$port" setsid nohup node app/server.mjs </dev/null >"$RUN/app-$port.log" 2>&1 9>&- &
    echo $! >"$RUN/app-$port.pid"
  )
}

# True when the manifest lists exactly the files that are on disk and every checksum matches.
# Sets VERIFY_MSG to the reason when it does not.
verify_artifact() {
  local dir="$1" listed present
  VERIFY_MSG=""
  if [ ! -f "$dir/MANIFEST.sha256" ]; then
    VERIFY_MSG="there is no MANIFEST.sha256"
    return 1
  fi
  listed="$(awk '{print $2}' "$dir/MANIFEST.sha256" | sed 's/^\*//' | sort)"
  present="$(cd "$dir" && find . -type f ! -name MANIFEST.sha256 | sed 's|^\./||' | sort)"
  if [ "$listed" != "$present" ]; then
    VERIFY_MSG="the files on disk are not the files in the manifest"
    return 1
  fi
  if ! (cd "$dir" && sha256sum --check --quiet MANIFEST.sha256 >/dev/null 2>&1); then
    VERIFY_MSG="a file does not match its checksum"
    return 1
  fi
}
