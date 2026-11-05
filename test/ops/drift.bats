#!/usr/bin/env bats
# drift.sh: the repository says one thing, the server does another.

load helper

setup_file() { setup_file_db; }
teardown_file() { teardown_file_db; }
setup() { start_server; }
teardown() { stop_server; }

@test "a fresh server matches the repository" {
  run "$OPT/ops/drift.sh" check
  [ "$status" -eq 0 ]
  [ "$(result_field result)" = "clean" ]
}

@test "a file edited by hand is reported as modified, with its path" {
  echo '# fixed by hand at 3am' >>"$GW_ROOT/live-config/systemd/groundwork-backup.timer"
  run "$OPT/ops/drift.sh" check
  [ "$status" -eq 1 ]
  [ "$(result | jq -r '.detail[0].state')" = "modified" ]
  [ "$(result | jq -r '.detail[0].path')" = "systemd/groundwork-backup.timer" ]
}

@test "a file that is gone is reported as missing, and one nobody asked for as extra" {
  rm "$GW_ROOT/live-config/nginx/security-headers.conf"
  echo 'x' >"$GW_ROOT/live-config/nginx/leftover.conf"
  run "$OPT/ops/drift.sh" check
  [ "$status" -eq 1 ]
  [ "$(result | jq -r '[.detail[] | .state + ":" + .path] | sort | join(" ")')" = "extra:nginx/leftover.conf missing:nginx/security-headers.conf" ]
}

@test "sync puts the repository's version back and keeps a copy of what it replaced" {
  echo '# fixed by hand' >>"$GW_ROOT/live-config/systemd/groundwork-backup.timer"
  echo 'x' >"$GW_ROOT/live-config/nginx/leftover.conf"
  run "$OPT/ops/drift.sh" sync
  [ "$status" -eq 0 ]
  run "$OPT/ops/drift.sh" check
  [ "$status" -eq 0 ]
  kept="$(ls -d "$GW_ROOT"/backups/drift-* | head -n 1)"
  grep -q 'fixed by hand' "$kept/systemd/groundwork-backup.timer"
  [ -f "$kept/nginx/leftover.conf" ]
  [ ! -e "$GW_ROOT/live-config/nginx/leftover.conf" ]
}

@test "sync with nothing to do changes nothing and keeps no copy" {
  run "$OPT/ops/drift.sh" sync
  [ "$status" -eq 0 ]
  [ -z "$(ls -d "$GW_ROOT"/backups/drift-* 2>/dev/null)" ]
}
