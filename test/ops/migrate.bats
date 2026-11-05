#!/usr/bin/env bats
# migrate.sh: the schema is ahead of the code, never behind it.

load helper

setup_file() { setup_file_db; }
teardown_file() { teardown_file_db; }
setup() { start_server; }
teardown() { stop_server; }

@test "--check lists what is pending and exits 12, without changing anything" {
  art="$(artifact v4-orders-status)"
  run "$OPT/ops/migrate.sh" "$art" --check
  [ "$status" -eq 12 ]
  [[ "$output" == *0002_orders_status* ]]
  run psql "$DATABASE_URL" -tAc "select to_regclass('public.schema_migrations') is not null"
  [ "$output" = "f" ]
}

@test "--apply runs each pending file in order and records it; running it again does nothing" {
  art="$(artifact v4-orders-status)"
  run "$OPT/ops/migrate.sh" "$art" --apply
  [ "$status" -eq 0 ]
  [[ "$output" == *"applying 0002_orders_status"* ]]
  run psql "$DATABASE_URL" -tAc "select count(*) from information_schema.columns where table_name='orders' and column_name='status'"
  [ "$output" = "1" ]
  run "$OPT/ops/migrate.sh" "$art" --apply
  [[ "$output" == *"applied 0 migration"* ]]
  run "$OPT/ops/migrate.sh" "$art" --check
  [ "$status" -eq 0 ]
}

@test "a failing migration leaves nothing half applied" {
  art="$BATS_TEST_TMPDIR/bad"
  mkdir -p "$art/migrations"
  printf 'create table half_done (id int);\nselect 1/0;\n' >"$art/migrations/0003_explodes.sql"
  run "$OPT/ops/migrate.sh" "$art" --apply
  [ "$status" -ne 0 ]
  run psql "$DATABASE_URL" -tAc "select to_regclass('public.half_done') is not null"
  [ "$output" = "f" ]
  run psql "$DATABASE_URL" -tAc "select count(*) from schema_migrations where version = '0003_explodes'"
  [ "$output" = "0" ]
}

@test "a migration named so that it could carry SQL is refused before it is trusted" {
  art="$BATS_TEST_TMPDIR/evil"
  mkdir -p "$art/migrations"
  printf 'select 1;\n' >"$art/migrations/0004_x'; drop table orders; --.sql"
  run "$OPT/ops/migrate.sh" "$art" --check
  [ "$status" -eq 2 ]
  run psql "$DATABASE_URL" -tAc "select count(*) from orders"
  [ "$output" != "" ]
}
