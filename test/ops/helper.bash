# shellcheck shell=bash
# Shared by every .bats file. Each test gets a complete second "server" of its own: its own root directory, its own nginx
# on its own ports, its own release processes. The database is one per file (created in setup_file).

OPT=/opt/groundwork

setup_file_db() {
  : "${GW_TEST_ADMIN_URL:?the tests run through docker compose: make test-ops}"
  FILE_DB="gwtest_$$_$(date +%s)"
  psql "$GW_TEST_ADMIN_URL" -qc "create database \"$FILE_DB\"" >/dev/null
  FILE_DB_URL="${GW_TEST_ADMIN_URL%/*}/$FILE_DB"
  psql "$FILE_DB_URL" -q -f "$OPT/test/ops/seed.sql" >/dev/null
  export FILE_DB FILE_DB_URL
}

teardown_file_db() {
  psql "$GW_TEST_ADMIN_URL" -qc "drop database if exists \"$FILE_DB\" with (force)" >/dev/null 2>&1 || true
}

# A fresh server: boot it the way the container does, and start nginx.
start_server() {
  export GW_ROOT="$BATS_TEST_TMPDIR/gw" GW_OPT="$OPT" GW_EDGE_PORT=18080 GW_CONTROL_PORT=13000
  export GW_SLOT_A=14101 GW_SLOT_B=14102 GW_HEALTH_TIMEOUT=6 GW_DRAIN=0
  export DATABASE_URL="$FILE_DB_URL" GW_DB_HOST=db
  mkdir -p "$GW_ROOT"
  "$OPT/ops/boot.sh" >/dev/null
  nginx -e stderr -c "$GW_ROOT/run/nginx.conf"
}

stop_server() {
  # By pid, not by `nginx -s stop`: that parses the configuration first, and does nothing when a test (or a broken gate)
  # left an invalid one on disk. The master would then outlive the test, holding bats' output open forever.
  if [ -f "$GW_ROOT/run/nginx.pid" ]; then kill "$(cat "$GW_ROOT/run/nginx.pid")" 2>/dev/null || true; fi
  for port in "$GW_SLOT_A" "$GW_SLOT_B"; do
    if [ -f "$GW_ROOT/run/app-$port.pid" ]; then kill "$(cat "$GW_ROOT/run/app-$port.pid")" 2>/dev/null || true; fi
  done
}

# artifact <variant> [--tamper edit|add]  ->  prints the directory of a built artifact
artifact() {
  local out="$BATS_TEST_TMPDIR/art-$1"
  "$OPT/ops/build-release.sh" "$1" "$out" "${@:2}" >/dev/null
  printf '%s' "$out"
}

deploy() { "$OPT/ops/deploy.sh" "$@"; }

# forge <variant> <file> <content>  ->  prints the directory of an artifact whose MANIFEST is correct for what it contains,
# so it passes the artifact gate and only a later gate can object to it.
forge() {
  local dir manifest
  dir="$(artifact "$1")"
  printf '%s\n' "$3" >"$dir/$2"
  manifest="$(cd "$dir" && find . -type f ! -name MANIFEST.sha256 | sed 's|^\./||' | sort | xargs sha256sum)"
  printf '%s\n' "$manifest" >"$dir/MANIFEST.sha256"
  printf '%s' "$dir"
}

# nginx applies a reload a moment after the signal; after a reload that put an older configuration back, wait for it.
wait_for_edge() { # version
  for _ in $(seq 1 20); do
    [ "$(edge_version 2>/dev/null)" = "$1" ] && return 0
    sleep 0.25
  done
  return 1
}

# What the edge serves right now.
edge_version() { curl -fsS --max-time 3 "http://127.0.0.1:$GW_EDGE_PORT/app/version" | jq -r '.version'; }
edge_release_header() { curl -fsSI --max-time 3 "http://127.0.0.1:$GW_EDGE_PORT/app/version" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-release"{print $2}'; }

# The JSON on the last line every script prints.
# shellcheck disable=SC2154  # $output is set by bats' `run`
result() { printf '%s\n' "$output" | grep '^RESULT ' | tail -n 1 | sed 's/^RESULT //'; }
result_field() { result | jq -r ".$1"; }
