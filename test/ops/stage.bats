#!/usr/bin/env bats
# stage.sh: changes you can take back, and prove you took back.

load helper

setup_file() { setup_file_db; }
teardown_file() { teardown_file_db; }
setup() {
  start_server
  export GW_SANDBOX="$GW_ROOT/sandbox-root"
  sum() { sha256sum "$GW_SANDBOX/$1" | awk '{print $1}'; }
}
teardown() { stop_server; }

@test "list shows every stage as available on a fresh sandbox" {
  run "$OPT/ops/stage.sh" list
  [ "$status" -eq 0 ]
  [ "$(grep -c available <<<"$output")" -eq 3 ]
}

@test "a stage changes the file, passes its own check, and is listed as applied" {
  run "$OPT/ops/stage.sh" apply 01
  [ "$status" -eq 0 ]
  grep -qx 'PermitRootLogin no' "$GW_SANDBOX/etc/ssh/sshd_config"
  grep -qx 'PasswordAuthentication no' "$GW_SANDBOX/etc/ssh/sshd_config"
  run "$OPT/ops/stage.sh" list
  [[ "$output" == *"01 applied"* ]]
}

@test "reverting puts the file back byte for byte" {
  before="$(sum etc/ssh/sshd_config)"
  "$OPT/ops/stage.sh" apply 01 >/dev/null
  [ "$(sum etc/ssh/sshd_config)" != "$before" ]
  run "$OPT/ops/stage.sh" revert 01
  [ "$status" -eq 0 ]
  [ "$(sum etc/ssh/sshd_config)" = "$before" ]
}

@test "a stage that creates a file is reverted by deleting it" {
  "$OPT/ops/stage.sh" apply 02 >/dev/null
  [ -f "$GW_SANDBOX/etc/sysctl.d/90-groundwork.conf" ]
  "$OPT/ops/stage.sh" revert 02 >/dev/null
  [ ! -e "$GW_SANDBOX/etc/sysctl.d/90-groundwork.conf" ]
}

@test "applying the same stage twice is refused" {
  "$OPT/ops/stage.sh" apply 01 >/dev/null
  run "$OPT/ops/stage.sh" apply 01
  [ "$status" -eq 32 ]
  [ "$(result_field gate)" = "already_applied" ]
}

@test "a stage whose own check fails reverts itself and says why" {
  before="$(sum etc/security/limits.conf)"
  echo bad >"$GW_SANDBOX/var/lib/service-health"
  run "$OPT/ops/stage.sh" apply 03
  [ "$status" -eq 31 ]
  [ "$(result_field gate)" = "verification_failed" ]
  [[ "$(result_field message)" == *"service reports bad"* ]]
  [ "$(sum etc/security/limits.conf)" = "$before" ]
  run "$OPT/ops/stage.sh" list
  [[ "$output" == *"03 available"* ]]
}

@test "revert --all undoes every applied stage, newest first, and every file is as it was" {
  s1="$(sum etc/ssh/sshd_config)"
  s3="$(sum etc/security/limits.conf)"
  for n in 01 02 03; do "$OPT/ops/stage.sh" apply "$n" >/dev/null; sleep 1; done
  run "$OPT/ops/stage.sh" revert --all
  [ "$status" -eq 0 ]
  [ "$(sum etc/ssh/sshd_config)" = "$s1" ]
  [ "$(sum etc/security/limits.conf)" = "$s3" ]
  [ ! -e "$GW_SANDBOX/etc/sysctl.d/90-groundwork.conf" ]
}

@test "a revert that cannot restore a file exactly says so" {
  "$OPT/ops/stage.sh" apply 01 >/dev/null
  # corrupt the backup: the restored file can no longer match the checksum taken before the change
  echo corrupted >"$(ls -d "$GW_ROOT"/backups/stages/01-* | head -n 1)/files/etc/ssh/sshd_config"
  run "$OPT/ops/stage.sh" revert 01
  [ "$status" -eq 33 ]
  [ "$(result_field gate)" = "revert_not_exact" ]
}

@test "an unknown stage is refused" {
  run "$OPT/ops/stage.sh" apply 99
  [ "$status" -eq 30 ]
}

@test "nothing outside the sandbox is touched: a path with .. is refused" {
  mkdir -p "$BATS_TEST_TMPDIR/stages-evil"
  cat >"$BATS_TEST_TMPDIR/stages-evil/01-evil.sh" <<'EOF'
title="reaches out of the root"
apply() { keep ../../etc/passwd; }
verify() { true; }
EOF
  GW_OPT="$BATS_TEST_TMPDIR/fake-opt"
  mkdir -p "$GW_OPT/ops"
  cp "$OPT/ops/lib.sh" "$OPT/ops/stage.sh" "$GW_OPT/ops/"
  cp -r "$BATS_TEST_TMPDIR/stages-evil" "$GW_OPT/ops/stages"
  export GW_OPT
  run "$GW_OPT/ops/stage.sh" apply 01
  [ "$status" -ne 0 ]
  [[ "$output" == *"outside the root"* ]]
}
