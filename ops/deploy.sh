#!/usr/bin/env bash
# Ship one release without a moment in which the site serves something nobody checked.
#
#   deploy.sh <artifact-dir>     ship it
#   deploy.sh --rollback         ship the most recent release that is not the current one, through the same gates
#
# The order is the point. Each step can refuse, and a refusal leaves the previous release serving:
#
#   copy -> verify the COPY -> secrets file mode -> migrations -> start the candidate on the idle slot -> health gate
#        -> `nginx -t` -> reload -> verify through the edge -> commit (symlink, prune) -> drain the old slot
#
# Exit codes: 0 shipped | 2 usage | 10 artifact_unverified | 11 env_permissions | 12 migrations_pending | 13 unhealthy
#             14 nginx_invalid | 15 edge_verification_failed | 16 deploy_in_progress | 17 nothing_to_roll_back
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

NAME="unknown"
VERSION=""
CAND_PORT=""
CAND_DIR=""
KEEP_CAND=0 # a rollback re-ships a release that is already on disk; failing must not delete it
FLIPPED=0   # 1 once the edge points at the candidate

# Stops the candidate, puts the edge back as it was, and says which gate refused.
fail() { # gate code message
  local gate="$1" code="$2" message="$3" outcome="refused"
  [ "$FLIPPED" = 1 ] && outcome="rolled_back"
  [ -n "$CAND_PORT" ] && stop_slot "$CAND_PORT"
  if [ -n "$CAND_DIR" ] && [ "$KEEP_CAND" = 0 ]; then rm -rf "$CAND_DIR"; fi
  event "$NAME" "$gate" "$outcome" "$message"
  say "x $gate: $message"
  if [ -f "$RUN/live-slot" ]; then say "  the previous release is still serving"; else say "  there was no previous release"; fi
  result_line false "$gate" "$outcome" "$message" "$NAME"
  exit "$code"
}

restore_edge() {
  [ -f "$RUN/upstream-live.conf.prev" ] && cp "$RUN/upstream-live.conf.prev" "$RUN/upstream-live.conf"
  [ -f "$RUN/release-snippet.conf.prev" ] && cp "$RUN/release-snippet.conf.prev" "$RUN/release-snippet.conf"
  return 0
}

# -e stderr: the binary would otherwise open its compiled-in log path first, which a non-root user may not write.
nginx_check() { nginx -e stderr -c "$RUN/nginx.conf" -t 2>&1; }
nginx_reload() { nginx -e stderr -c "$RUN/nginx.conf" -s reload; }

mkdir -p "$RELEASES" "$RUN"
exec 9>"$RUN/deploy.lock"
flock -n 9 || fail deploy_in_progress 16 "another deploy is running"

SRC=""
case "${1:-}" in
  --rollback)
    current="$(readlink -f "$GW_ROOT/current" 2>/dev/null || true)"
    target=""
    while IFS= read -r candidate; do
      [ "$RELEASES/$candidate" = "$current" ] && continue
      target="$RELEASES/$candidate"
      break
    done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | sort -r)
    [ -n "$target" ] || fail nothing_to_roll_back 17 "there is no other release on disk"
    SRC="$target"
    KEEP_CAND=1
    CAND_DIR="$SRC"
    ;;
  "")
    echo "usage: deploy.sh <artifact-dir> | --rollback" >&2
    exit 2
    ;;
  *) SRC="$1" ;;
esac

[ -f "$SRC/release.json" ] || fail artifact_unverified 10 "there is no release.json in $SRC"
NAME="$(jq -r '.name' "$SRC/release.json")"
VERSION="$(jq -r '.version' "$SRC/release.json")"
say "==> shipping $NAME $VERSION"

# 1. Copy first, then verify the copy: what is checked has to be what will run, not what the source was a moment ago.
if [ "$KEEP_CAND" = 0 ]; then
  CAND_DIR="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-$NAME"
  cp -a "$SRC" "$CAND_DIR"
fi
verify_artifact "$CAND_DIR" || fail artifact_unverified 10 "$VERIFY_MSG"
say "ok artifact verified ($(wc -l <"$CAND_DIR/MANIFEST.sha256") files)"

# 2. The secrets file must not be readable by anyone else on a shared host.
mode="$(stat -c '%a' "$SHARED/app.env" 2>/dev/null || echo missing)"
[ "$mode" = "600" ] || fail env_permissions 11 "app.env has mode $mode; it must be 600"
say "ok secrets file is private"

# 3. The schema has to be ahead of the code, never behind it.
if ! out="$("$OPS/migrate.sh" "$CAND_DIR" --check 2>&1)"; then
  fail migrations_pending 12 "$(printf '%s' "$out" | head -n 1)"
fi
say "ok no pending migrations"

# 4. Start the candidate beside the live release, on the idle slot.
live=""
[ -f "$RUN/live-slot" ] && live="$(cat "$RUN/live-slot")"
if [ "$live" = "$GW_SLOT_A" ]; then CAND_PORT="$GW_SLOT_B"; else CAND_PORT="$GW_SLOT_A"; fi
stop_slot "$CAND_PORT"
start_slot "$CAND_PORT" "$CAND_DIR"

# 5. Health gate: it must answer, and it must be the version we think it is.
deadline=$((SECONDS + GW_HEALTH_TIMEOUT))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if body="$(curl -fsS --max-time 2 "http://127.0.0.1:$CAND_PORT/healthz" 2>/dev/null)"; then
    [ "$(printf '%s' "$body" | jq -r '.version' 2>/dev/null)" = "$VERSION" ] && { healthy=1; break; }
  fi
  sleep 0.5
done
if [ "$healthy" != 1 ]; then
  detail="$(curl -s --max-time 2 "http://127.0.0.1:$CAND_PORT/healthz" 2>/dev/null | head -c 160 || true)"
  fail unhealthy 13 "no healthy answer in ${GW_HEALTH_TIMEOUT}s${detail:+ ($detail)}"
fi
say "ok candidate is healthy on :$CAND_PORT"

# 6. Point the edge at it, but only if nginx accepts the configuration, and verify through the edge itself.
cp "$RUN/upstream-live.conf" "$RUN/upstream-live.conf.prev"
cp "$RUN/release-snippet.conf" "$RUN/release-snippet.conf.prev"
printf 'server 127.0.0.1:%s;\n' "$CAND_PORT" >"$RUN/upstream-live.conf"
cp "$CAND_DIR/nginx/release.conf" "$RUN/release-snippet.conf"
if ! out="$(nginx_check)"; then
  restore_edge
  fail nginx_invalid 14 "$(printf '%s' "$out" | grep -m1 '\[emerg\]' | sed 's/^.*\[emerg\] [0-9#: ]*//' || true)"
fi
say "ok nginx accepts the configuration"
nginx_reload
FLIPPED=1

edge_ok=0
for _ in $(seq 1 20); do
  seen="$(curl -fsS --max-time 2 "http://127.0.0.1:$GW_EDGE_PORT/app/version" 2>/dev/null | jq -r '.version' 2>/dev/null || true)"
  [ "$seen" = "$VERSION" ] && { edge_ok=1; break; }
  sleep 0.5
done
if [ "$edge_ok" != 1 ]; then
  restore_edge
  nginx_check >/dev/null && nginx_reload
  fail edge_verification_failed 15 "the edge did not serve $VERSION after the reload"
fi
say "ok the edge serves $VERSION"

# 7. Commit. From here the new release is the current one.
printf '%s\n' "$CAND_PORT" >"$RUN/live-slot"
ln -sfn "$CAND_DIR" "$GW_ROOT/current"
if [ -n "$live" ]; then
  sleep "$GW_DRAIN"
  stop_slot "$live"
fi

# Keep the newest few, never the one that is serving.
current="$(readlink -f "$GW_ROOT/current")"
find "$RELEASES" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort -r | tail -n +"$((GW_KEEP + 1))" | while IFS= read -r old; do
  [ "$RELEASES/$old" = "$current" ] || rm -rf "${RELEASES:?}/$old"
done

if [ "$KEEP_CAND" = 1 ]; then
  event "$NAME" "rollback" "rolled_back" "shipped again by hand"
  result_line true "rollback" "rolled_back" "$NAME $VERSION is serving again" "$NAME"
else
  event "$NAME" "all" "shipped" "every gate passed"
  result_line true "all" "shipped" "$NAME $VERSION is serving" "$NAME"
fi
say "ok $NAME $VERSION is serving"
