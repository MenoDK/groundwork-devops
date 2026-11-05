#!/usr/bin/env bats
# backup.sh: a backup is only a backup once it has been restored.

load helper

setup_file() { setup_file_db; }
teardown_file() { teardown_file_db; }
setup() { start_server; }
teardown() { stop_server; }

latest() { ls -1t "$GW_ROOT"/backups/db-*.dump | head -n 1; }

@test "take writes a dump, a checksum and the row count of every table" {
  run "$OPT/ops/backup.sh" take
  [ "$status" -eq 0 ]
  dump="$(latest)"
  [ -s "$dump" ]
  [ -s "$dump.sha256" ]
  [ "$(jq -r '.tables.orders' "$dump.meta.json")" = "50" ]
}

@test "a good backup restores and every table has the rows it had" {
  "$OPT/ops/backup.sh" take >/dev/null
  run "$OPT/ops/backup.sh" drill "$(latest)"
  [ "$status" -eq 0 ]
  [ "$(result_field gate)" = "drill" ]
}

@test "the drill leaves no scratch database behind" {
  # Before and after, not "none": the mutant that leaves a scratch database behind (scripts/sabotage.sh) runs against the
  # same server and is supposed to leave some, and a leftover from somebody else's drill is not this drill's fault.
  scratch() { psql "$GW_TEST_ADMIN_URL" -tAc "select count(*) from pg_database where datname like 'drill_%'"; }
  before="$(scratch)"
  "$OPT/ops/backup.sh" take >/dev/null
  "$OPT/ops/backup.sh" drill "$(latest)" >/dev/null
  [ "$(scratch)" = "$before" ]
}

@test "a dump with damaged bytes fails on its checksum, before anything is restored" {
  "$OPT/ops/backup.sh" take >/dev/null
  copy="$BATS_TEST_TMPDIR/damaged.dump"
  cp "$(latest)" "$copy"
  cp "$(latest).sha256" "$copy.sha256"
  # change one byte in the middle
  printf '\xff' | dd of="$copy" bs=1 seek=$(( $(stat -c %s "$copy") / 2 )) conv=notrunc 2>/dev/null
  run "$OPT/ops/backup.sh" drill "$copy"
  [ "$status" -eq 20 ]
  [ "$(result_field gate)" = "checksum_mismatch" ]
}

@test "a dump with no checksum next to it is not trusted" {
  "$OPT/ops/backup.sh" take >/dev/null
  copy="$BATS_TEST_TMPDIR/orphan.dump"
  cp "$(latest)" "$copy"
  run "$OPT/ops/backup.sh" drill "$copy"
  [ "$status" -eq 20 ]
}

@test "a dump that restores but holds fewer rows than were counted is caught" {
  "$OPT/ops/backup.sh" take >/dev/null
  copy="$BATS_TEST_TMPDIR/short.dump"
  cp "$(latest)" "$copy"
  # a dump taken from a database where rows were deleted, with the meta of the full one
  psql "$DATABASE_URL" -qc "delete from orders where id > 40"
  pg_dump "$DATABASE_URL" -Fc --no-owner -f "$copy"
  (cd "$BATS_TEST_TMPDIR" && sha256sum short.dump >short.dump.sha256)
  cp "$(latest).meta.json" "$copy.meta.json"
  run "$OPT/ops/backup.sh" drill "$copy"
  [ "$status" -eq 21 ]
  [ "$(result_field gate)" = "rows_mismatch" ]
  [[ "$(result_field message)" == *orders* ]]
}

@test "rotate keeps the newest few and removes the rest with their files" {
  for _ in 1 2 3 4; do "$OPT/ops/backup.sh" take >/dev/null; sleep 1; done
  run "$OPT/ops/backup.sh" rotate 2
  [ "$status" -eq 0 ]
  [ "$(ls "$GW_ROOT"/backups/db-*.dump | wc -l)" -eq 2 ]
  [ "$(ls "$GW_ROOT"/backups/db-*.sha256 | wc -l)" -eq 2 ]
  [ "$(ls "$GW_ROOT"/backups/db-*.meta.json | wc -l)" -eq 2 ]
}

@test "rotate also removes the damaged copy of a dump it deletes, and leaves the copy of one it keeps" {
  for _ in 1 2 3; do "$OPT/ops/backup.sh" take >/dev/null; sleep 1; done
  oldest="$(ls -1tr "$GW_ROOT"/backups/db-*.dump | head -n 1)"
  newest="$(latest)"
  for dump in "$oldest" "$newest"; do
    copy="$GW_ROOT/backups/damaged-$(basename "$dump" | sed 's/^db-//')"
    cp "$dump" "$copy" # the lab makes its copies the same way, under the dump's own stamp
  done
  run "$OPT/ops/backup.sh" rotate 1
  [ "$status" -eq 0 ]
  [ ! -e "$GW_ROOT/backups/damaged-$(basename "$oldest" | sed 's/^db-//')" ]
  [ -e "$GW_ROOT/backups/damaged-$(basename "$newest" | sed 's/^db-//')" ]
}

@test "rotate refuses to keep nothing" {
  run "$OPT/ops/backup.sh" rotate 0
  [ "$status" -eq 2 ]
}

@test "list is JSON, newest first" {
  "$OPT/ops/backup.sh" take >/dev/null
  sleep 1
  "$OPT/ops/backup.sh" take >/dev/null
  run "$OPT/ops/backup.sh" list
  [ "$(jq 'length' <<<"$output")" -eq 2 ]
  [ "$(jq -r '.[0].file > .[1].file' <<<"$output")" = "true" ]
}

@test "a DATABASE_URL with a query string is refused, because the scratch database is addressed by replacing the name" {
  printf "DATABASE_URL='%s?sslmode=disable'\n" "$FILE_DB_URL" >"$GW_ROOT/shared/app.env"
  run "$OPT/ops/backup.sh" take
  [ "$status" -eq 2 ]
}
