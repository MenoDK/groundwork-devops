#!/usr/bin/env bats
# deploy.sh, one gate at a time. Every test runs the real script against a real nginx, real processes and a real database.

load helper

setup_file() { setup_file_db; }
teardown_file() { teardown_file_db; }
setup() { start_server; }
teardown() { stop_server; }

@test "the first release ships, and the edge serves it" {
  run deploy "$(artifact v1)"
  [ "$status" -eq 0 ]
  [ "$(result_field ok)" = "true" ]
  [ "$(edge_version)" = "1.0.0" ]
  [ "$(edge_release_header)" = "v1" ]
  [ "$(readlink "$GW_ROOT/current" | xargs basename | cut -d- -f2-)" = "v1" ]
}

@test "a second release replaces the first, and the old process is stopped" {
  deploy "$(artifact v1)"
  old_slot="$(cat "$GW_ROOT/run/live-slot")"
  run deploy "$(artifact v2)"
  [ "$status" -eq 0 ]
  [ "$(edge_version)" = "1.1.0" ]
  [ "$(cat "$GW_ROOT/run/live-slot")" != "$old_slot" ]
  run curl -sS --max-time 2 "http://127.0.0.1:$old_slot/healthz"
  [ "$status" -ne 0 ]
}

@test "a release that cannot reach its database is refused and the old release keeps serving" {
  deploy "$(artifact v1)"
  run deploy "$(artifact v3-no-database)"
  [ "$status" -eq 13 ]
  [ "$(result_field gate)" = "unhealthy" ]
  [ "$(result_field result)" = "refused" ]
  [ "$(edge_version)" = "1.0.0" ]
  # nothing of the refused release is left behind
  [ "$(ls "$GW_ROOT/releases" | wc -l)" -eq 1 ]
}

@test "the very first release can be refused too, and then there is nothing to serve" {
  run deploy "$(artifact v3-no-database)"
  [ "$status" -eq 13 ]
  run curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$GW_EDGE_PORT/app/version"
  [ "$output" = "502" ]
}

@test "a release that needs a migration is refused until the migration has run" {
  deploy "$(artifact v1)"
  run deploy "$(artifact v4-orders-status)"
  [ "$status" -eq 12 ]
  [ "$(result_field gate)" = "migrations_pending" ]
  [[ "$(result_field message)" == *0002_orders_status* ]]
  [ "$(edge_version)" = "1.0.0" ]

  run "$OPT/ops/migrate.sh" "$(artifact v4-orders-status)" --apply
  [ "$status" -eq 0 ]
  run deploy "$(artifact v4-orders-status)"
  [ "$status" -eq 0 ]
  [ "$(edge_version)" = "1.3.0" ]
}

@test "a release whose nginx snippet is invalid never reaches nginx" {
  deploy "$(artifact v1)"
  run deploy "$(artifact v5-bad-edge-config)"
  [ "$status" -eq 14 ]
  [ "$(result_field gate)" = "nginx_invalid" ]
  [[ "$(result_field message)" == *add_header_cache_control* ]]
  # the previous configuration is back, and still valid
  run nginx -e stderr -c "$GW_ROOT/run/nginx.conf" -t
  [ "$status" -eq 0 ]
  [ "$(edge_version)" = "1.0.0" ]
  [ "$(edge_release_header)" = "v1" ]
}

@test "a release the edge does not serve as itself is taken back at the edge" {
  deploy "$(artifact v1)"
  slot_before="$(cat "$GW_ROOT/run/live-slot")"
  # Valid nginx, a healthy process and a correct manifest: the one thing wrong is what the edge answers once it points here.
  run deploy "$(forge v2 nginx/release.conf "return 200 '{\"version\":\"0.0.0\"}';")"
  [ "$status" -eq 15 ]
  [ "$(result_field gate)" = "edge_verification_failed" ]
  [ "$(result_field result)" = "rolled_back" ]
  wait_for_edge 1.0.0
  [ "$(edge_release_header)" = "v1" ]
  # the live slot is the old one, and nothing of the refused release is left on disk
  [ "$(cat "$GW_ROOT/run/live-slot")" = "$slot_before" ]
  [ "$(ls "$GW_ROOT/releases" | wc -l)" -eq 1 ]
}

@test "an artifact changed after its manifest was written is refused (edit)" {
  run deploy "$(artifact v1 --tamper edit)"
  [ "$status" -eq 10 ]
  [ "$(result_field gate)" = "artifact_unverified" ]
  [[ "$(result_field message)" == *checksum* ]]
}

@test "an artifact with a file the manifest never listed is refused (add)" {
  run deploy "$(artifact v1 --tamper add)"
  [ "$status" -eq 10 ]
  [[ "$(result_field message)" == *"not the files in the manifest"* ]]
}

@test "a shipped release does not depend on the artifact directory it came from" {
  # The release directory is its own verified copy. (That the COPY is what gets verified is a race, which no test can
  # pin down; the ordering is in deploy.sh and is explained there.)
  art="$(artifact v2)"
  run deploy "$art"
  [ "$status" -eq 0 ]
  echo '// changed later' >>"$art/app/server.mjs"
  current="$(readlink -f "$GW_ROOT/current")"
  run bash -c "cd '$current' && sha256sum --check --quiet MANIFEST.sha256"
  [ "$status" -eq 0 ]
}

@test "a secrets file that other users can read stops the deploy" {
  chmod 644 "$GW_ROOT/shared/app.env"
  run deploy "$(artifact v1)"
  [ "$status" -eq 11 ]
  [ "$(result_field gate)" = "env_permissions" ]
  [[ "$(result_field message)" == *644* ]]
  chmod 600 "$GW_ROOT/shared/app.env"
  run deploy "$(artifact v1)"
  [ "$status" -eq 0 ]
}

@test "two deploys at once: the second one is refused, not interleaved" {
  deploy "$(artifact v1)"
  exec 8>"$GW_ROOT/run/deploy.lock"
  flock -n 8
  run deploy "$(artifact v2)"
  [ "$status" -eq 16 ]
  [ "$(result_field gate)" = "deploy_in_progress" ]
  exec 8>&-
  [ "$(edge_version)" = "1.0.0" ]
}

@test "rollback ships the previous release through the same gates" {
  deploy "$(artifact v1)"
  deploy "$(artifact v2)"
  [ "$(edge_version)" = "1.1.0" ]
  run deploy --rollback
  [ "$status" -eq 0 ]
  [ "$(result_field gate)" = "rollback" ]
  [ "$(edge_version)" = "1.0.0" ]
  [ "$(edge_release_header)" = "v1" ]
}

@test "rollback with only one release on disk says so" {
  deploy "$(artifact v1)"
  run deploy --rollback
  [ "$status" -eq 17 ]
  [ "$(result_field gate)" = "nothing_to_roll_back" ]
  [ "$(edge_version)" = "1.0.0" ]
}

@test "old releases are pruned, and the one serving is never among them" {
  export GW_KEEP=2
  for v in v1 v2 v1 v2; do deploy "$(artifact "$v")"; sleep 1; done
  [ "$(ls "$GW_ROOT/releases" | wc -l)" -eq 2 ]
  [ -d "$(readlink -f "$GW_ROOT/current")" ]
  [ "$(edge_version)" = "1.1.0" ]
}

@test "pruning never removes the release that is serving, even when it is not the newest" {
  deploy "$(artifact v1)"
  sleep 1
  deploy "$(artifact v2)"
  export GW_KEEP=1
  run deploy --rollback
  [ "$status" -eq 0 ]
  # "keep the newest 1" would keep v2, and "never the one serving" keeps v1: both stay, and the link is not left dangling
  [ "$(ls "$GW_ROOT/releases" | wc -l)" -eq 2 ]
  [ -d "$(readlink -f "$GW_ROOT/current")" ]
  [ "$(readlink -f "$GW_ROOT/current" | xargs basename | cut -d- -f2-)" = "v1" ]
  [ "$(edge_version)" = "1.0.0" ]
}

@test "every decision is one line of history" {
  deploy "$(artifact v1)"
  deploy "$(artifact v3-no-database)" || true
  run jq -rs 'map(.gate + ":" + .result) | join(" ")' "$GW_ROOT/deploy-log.jsonl"
  [ "$output" = "all:shipped unhealthy:refused" ]
}

@test "no request fails while one release replaces another" {
  export GW_DRAIN=1
  deploy "$(artifact v1)"
  (for _ in $(seq 1 120); do curl -s -o /dev/null -w '%{http_code}\n' -m 2 "http://127.0.0.1:$GW_EDGE_PORT/app/version"; sleep 0.03; done >"$BATS_TEST_TMPDIR/codes") &
  hammer=$!
  sleep 0.3
  run deploy "$(artifact v2)"
  [ "$status" -eq 0 ]
  wait "$hammer"
  [ "$(sort -u "$BATS_TEST_TMPDIR/codes")" = "200" ]
  [ "$(wc -l <"$BATS_TEST_TMPDIR/codes")" -eq 120 ]
}

@test "a restart brings the live release back on the slot it was on" {
  deploy "$(artifact v2)"
  slot="$(cat "$GW_ROOT/run/live-slot")"
  kill "$(cat "$GW_ROOT/run/app-$slot.pid")"
  sleep 0.5
  run curl -sS --max-time 2 "http://127.0.0.1:$slot/healthz"
  [ "$status" -ne 0 ]
  "$OPT/ops/boot.sh" >/dev/null
  nginx -e stderr -c "$GW_ROOT/run/nginx.conf" -s reload
  for _ in $(seq 1 20); do [ "$(edge_version 2>/dev/null)" = "1.1.0" ] && break; sleep 0.5; done
  [ "$(edge_version)" = "1.1.0" ]
}
