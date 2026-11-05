#!/usr/bin/env bash
# Mutation check by hand: break one gate at a time and require the test that is meant to watch it to go RED.
# A suite that stays green on a broken gate proves nothing, and this is the proof that each gate is watched.
#
#   scripts/sabotage.sh              all mutants
#   scripts/sabotage.sh backup       only the mutants whose name contains "backup"
#
# Three kinds of mutant, and every one of them is changed in a COPY. The working tree is never written to, so a run that
# is interrupted (or two that overlap) cannot leave a broken gate behind in the real source:
#   ops    a shell script in ops/ is changed in a copy that is mounted over the one in the test image (bats)
#   api    a TypeScript file in src/ is changed in a copy of src/ and test/api/, with the real node_modules linked in (vitest)
#   rules  an alert rule is changed in a copy of prometheus/ (promtool test rules)
#
# Each mutant names the test that must notice it (a bats --filter, or a vitest file), so a pass here means "that
# test watches that gate", not just "something somewhere failed". As a canary, the tree is hashed before and after.
# The patterns below are literal source text, `$` and quotes included; none of them is meant to expand here.
# shellcheck disable=SC2016,SC1003
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
only="${1:-}"

# Two runs at once would fight over the same containers and the same database; the second one stops here. The lock is
# inherited by the test containers, so it is held until the last of them is gone.
exec 8>"${TMPDIR:-/tmp}/groundwork-sabotage.lock"
if ! flock -n 8; then
  echo "another sabotage run is active; wait for it, or for its containers to exit" >&2
  exit 2
fi

tree_hash() { find ops src prometheus test -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum; }
before="$(tree_hash)"
total=0 killed=0 survivors=0 errors=0
work="$(mktemp -d)"

cleanup() { rm -rf "$work"; }
# A trap on a signal that does not end in `exit` lets the script carry on where it was interrupted; this one stops.
interrupted() {
  echo "interrupted: stopping the test containers" >&2
  docker ps -aq --filter name=groundwork-ops-test-run | xargs -r docker rm -f >/dev/null 2>&1
  exit 130
}
trap cleanup EXIT
trap interrupted INT TERM

# replace <file> <old> <new>: the old text must occur exactly once, so a mutant cannot silently miss its target.
replace() {
  python3 - "$1" "$2" "$3" <<'PY'
import pathlib, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = pathlib.Path(path).read_text()
if text.count(old) != 1:
    sys.exit(f"pattern must occur exactly once in {path}, found {text.count(old)}")
pathlib.Path(path).write_text(text.replace(old, new))
PY
}

report() { # name outcome detail
  case "$2" in
    killed) killed=$((killed + 1)); printf '  killed    %s   (%s)\n' "$1" "$3" ;;
    survived) survivors=$((survivors + 1)); printf '  SURVIVED  %s   (%s)\n' "$1" "$3" ;;
    *) errors=$((errors + 1)); printf '  [error]   %s   (%s)\n' "$1" "$3" ;;
  esac
}

wanted() { [ -z "$only" ] || [[ "$1" == *"$only"* ]]; }

# ops_mutant "<name>" <file in ops/> "<old>" "<new>" <bats file> "<test name filter>"
ops_mutant() {
  local name="$1" file="$2" old="$3" new="$4" bats="$5" filter="$6" out copy
  wanted "$name" || return 0
  total=$((total + 1))
  copy="$work/ops-$total"
  cp -a ops "$copy"
  chmod -R a+rX "$copy"
  if ! replace "$copy/$file" "$old" "$new"; then
    report "$name" error "the mutation did not apply"
    return 0
  fi
  out="$(timeout 240 docker compose --profile test run --rm -T -v "$copy:/opt/groundwork/ops:ro" ops-test \
    bats --filter "$filter" "test/ops/$bats.bats" 2>&1)"
  local status=$?
  if [ "$status" -eq 124 ]; then
    # a hung run must not stall the rest, and must not leave its container behind
    docker ps -aq --filter name=groundwork-ops-test-run | xargs -r docker rm -f >/dev/null 2>&1
    report "$name" error "the test run did not finish in 240 s"
  elif grep -q '^1\.\.0' <<<"$out"; then
    report "$name" error "the filter '$filter' matched no test"
  elif grep -q '^not ok' <<<"$out"; then
    report "$name" killed "$(grep -m1 '^not ok' <<<"$out" | sed 's/^not ok [0-9]* //')"
  elif grep -q '^ok ' <<<"$out"; then
    report "$name" survived "'$filter' still passed"
  else
    report "$name" error "the test run did not start: $(tail -n 3 <<<"$out" | tr '\n' ' ')"
  fi
  rm -rf "$copy"
}

# api_mutant "<name>" <file in src/> "<old>" "<new>" <vitest file>
api_mutant() {
  local name="$1" file="$2" old="$3" new="$4" spec="$5" out copy
  wanted "$name" || return 0
  total=$((total + 1))
  copy="$work/api-$total"
  mkdir -p "$copy/test"
  cp -a src "$copy/src"
  cp -a test/api "$copy/test/api"
  cp package.json tsconfig.json tsconfig.build.json vitest.config.ts "$copy/"
  ln -s "$PWD/node_modules" "$copy/node_modules"
  if ! replace "$copy/$file" "$old" "$new"; then
    rm -rf "$copy"
    report "$name" error "the mutation did not apply"
    return 0
  fi
  out="$(cd "$copy" && pnpm exec vitest run --reporter=dot "$spec" 2>&1)"
  rm -rf "$copy"
  if grep -qE 'Tests +[0-9]+ failed|FAIL ' <<<"$out"; then
    report "$name" killed "$(grep -cE '^ *FAIL ' <<<"$out") test(s) failed in $(basename "$spec")"
  elif grep -qE 'Tests +[0-9]+ passed' <<<"$out"; then
    report "$name" survived "every test in $(basename "$spec") still passed"
  else
    report "$name" error "vitest did not run: $(tail -n 3 <<<"$out" | tr '\n' ' ')"
  fi
}

# rules_mutant "<name>" "<old>" "<new>"
rules_mutant() {
  local name="$1" old="$2" new="$3" out copy
  wanted "$name" || return 0
  total=$((total + 1))
  copy="$work/rules-$total"
  cp -a prometheus "$copy"
  chmod -R a+rX "$copy"
  if ! replace "$copy/rules.yml" "$old" "$new"; then
    report "$name" error "the mutation did not apply"
    return 0
  fi
  if out="$(docker run --rm --entrypoint promtool -v "$copy:/p:ro" prom/prometheus:v2.55.1 test rules /p/rules.test.yml 2>&1)"; then
    report "$name" survived "promtool test rules still passed"
  elif grep -q 'FAILED' <<<"$out"; then
    report "$name" killed "$(grep -m1 'name:' <<<"$out" | sed 's/^ *name: //')"
  else
    report "$name" error "promtool did not run: $(tail -n 3 <<<"$out" | tr '\n' ' ')"
  fi
  rm -rf "$copy"
}

echo "building the test image once"
docker compose --profile test build ops-test >/dev/null 2>&1 || { echo "could not build the ops-test image" >&2; exit 2; }

echo "mutants (each must be killed by the test named):"
# --- shipping ---------------------------------------------------------------------------------------------------------
ops_mutant "deploy: the copy is not verified"              deploy.sh 'verify_artifact "$CAND_DIR" || fail artifact_unverified 10 "$VERIFY_MSG"' 'verify_artifact "$CAND_DIR" || true' deploy "changed after its manifest"
ops_mutant "deploy: a file nobody listed is accepted"      lib.sh    'if [ "$listed" != "$present" ]; then' 'if false; then' deploy "a file the manifest never listed"
ops_mutant "deploy: checksums are not compared"            lib.sh    'if ! (cd "$dir" && sha256sum --check --quiet MANIFEST.sha256 >/dev/null 2>&1); then' 'if false; then' deploy "changed after its manifest"
ops_mutant "deploy: a readable secrets file is accepted"   deploy.sh '[ "$mode" = "600" ] || fail env_permissions 11 "app.env has mode $mode; it must be 600"' '[ "$mode" = "600" ] || true' deploy "secrets file that other users"
ops_mutant "deploy: pending migrations are ignored"        deploy.sh 'if ! out="$("$OPS/migrate.sh" "$CAND_DIR" --check 2>&1)"; then' 'if false; then' deploy "needs a migration"
ops_mutant "deploy: the health gate always passes"         deploy.sh 'if [ "$healthy" != 1 ]; then' 'if false; then' deploy "cannot reach its database is refused"
ops_mutant "deploy: nginx -t is skipped"                   deploy.sh 'if ! out="$(nginx_check)"; then' 'if false; then' deploy "nginx snippet is invalid"
ops_mutant "deploy: the edge is not verified after reload" deploy.sh 'if [ "$edge_ok" != 1 ]; then' 'if false; then' deploy "does not serve as itself"
ops_mutant "deploy: the release in service can be pruned"  deploy.sh '[ "$RELEASES/$old" = "$current" ] || rm -rf "${RELEASES:?}/$old"' 'rm -rf "${RELEASES:?}/$old"' deploy "pruning never removes"
ops_mutant "deploy: two deploys can run at once"           deploy.sh 'flock -n 9 || fail deploy_in_progress 16 "another deploy is running"' 'flock -n 9 || true' deploy "two deploys at once"
ops_mutant "deploy: rollback may pick the release in service" deploy.sh '[ "$RELEASES/$candidate" = "$current" ] && continue' 'false && continue' deploy "rollback ships the previous"
# --- backups ----------------------------------------------------------------------------------------------------------
ops_mutant "backup: the checksum is not compared"          backup.sh 'if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then' 'if false; then' backup "damaged bytes"
ops_mutant "backup: the rows are not compared"             backup.sh 'if [ -n "$wrong" ]; then' 'if false; then' backup "fewer rows"
ops_mutant "backup: rotate may keep nothing"               backup.sh 'if ! [[ "$keep" =~ ^[0-9]+$ ]] || [ "$keep" -lt 1 ]; then' 'if ! [[ "$keep" =~ ^[0-9]+$ ]]; then' backup "refuses to keep nothing"
ops_mutant "backup: a URL with a query string is accepted" backup.sh '^postgres(ql)?://[^?]+/[A-Za-z0-9_]+$' '^postgres(ql)?://.+$' backup "query string"
ops_mutant "backup: the scratch database is left behind"   backup.sh 'psql "$DATABASE_URL" -qc "drop database if exists \"$scratch\"" >/dev/null 2>&1 || true' 'true' backup "no scratch database"
# That mutant did what it was written to do: it left scratch databases in the real server. Take them out, so the next run
# (and the next mutant) does not start from somebody else's mess.
printf '%s\n' "select format('drop database %I', datname) from pg_database where datname like 'drill\_%';" '\gexec' \
  | docker compose exec -T db psql -U groundwork -d groundwork -q >/dev/null 2>&1 || true
ops_mutant "backup: rotate leaves a dump's damaged copy behind" backup.sh 'rm -f "$old" "$old.sha256" "$old.meta.json" "$copy" "$copy.sha256" "$copy.meta.json"' 'rm -f "$old" "$old.sha256" "$old.meta.json"' backup "damaged copy of a dump it deletes"
# --- migrations -------------------------------------------------------------------------------------------------------
ops_mutant "migrate: a migration name is trusted"          migrate.sh 'if ! [[ "$version" =~ ^[0-9]{4}_[a-z0-9_]+$ ]]; then' 'if false; then' migrate "could carry SQL"
ops_mutant "migrate: a migration is not one transaction"   migrate.sh '-q --single-transaction \' '-q \' migrate "half applied"
# --- undoable changes -------------------------------------------------------------------------------------------------
ops_mutant "stage: its own check is not run"               stage.sh  'elif ! out="$(verify 2>&1)"; then' 'elif false; then' stage "own check fails"
ops_mutant "stage: a revert is not proven"                 stage.sh  'if [ "$kind" = modified ] && [ "$(sha256sum "$ROOT/$path" | awk '"'"'{print $1}'"'"')" != "$sum" ]; then' 'if false; then' stage "cannot restore a file exactly"
ops_mutant "stage: a path outside the root is accepted"    stage.sh  '/* | *..*) echo "refusing a path outside the root: $1" >&2; return 1 ;;' '/* | *..*) return 0 ;;' stage "nothing outside the sandbox"
ops_mutant "stage: the same stage can be applied twice"    stage.sh  'if [ -n "$(applied_dir "$n")" ]; then' 'if false; then' stage "applying the same stage twice"
ops_mutant "stage: a revert does not put the file back"    stage.sh  'modified) cp -a "$dir/files/$path" "$ROOT/$path" ;;' 'modified) true ;;' stage "puts the file back"
# --- drift ------------------------------------------------------------------------------------------------------------
ops_mutant "drift: a missing file is not reported"         drift.sh  'echo "missing $f"' 'true' drift "gone is reported"
ops_mutant "drift: a modified file is not reported"        drift.sh  'elif ! cmp -s "$DESIRED/$f" "$LIVE/$f"; then' 'elif false; then' drift "edited by hand"
ops_mutant "drift: an extra file is not reported"          drift.sh  '[ -f "$DESIRED/$f" ] || echo "extra $f"' 'true' drift "gone is reported"
# --- the firewall rules it prints -------------------------------------------------------------------------------------
ops_mutant "firewall: a truncated list is accepted"        firewall-docker.sh 'if [ "${#v4[@]}" -lt "$min4" ] || [ "${#v6[@]}" -lt "$min6" ]; then' 'if false; then' firewall "truncated list"
ops_mutant "firewall: a line that is not a CIDR is accepted" firewall-docker.sh 'exit 41' 'true' firewall "not a CIDR"
ops_mutant "firewall: an interface name is not checked"    firewall-docker.sh '^[A-Za-z0-9._-]+$' '.*' firewall "shell metacharacter"
# --- the control API --------------------------------------------------------------------------------------------------
api_mutant "api: a foreign Host is served"                 src/guards.ts 'if (!config.allowedHosts.has(host)) {' 'if (false) {' test/api/guards.test.ts
api_mutant "api: a foreign Origin may change things"       src/guards.ts "if (originHost !== (request.headers.host ?? '').toLowerCase()) {" 'if (false) {' test/api/guards.test.ts
api_mutant "api: a cross-site request may change things"   src/guards.ts "if (request.headers['sec-fetch-site'] === 'cross-site') {" 'if (false) {' test/api/guards.test.ts
api_mutant "api: the lab is allowed in production"         src/config.ts 'if (production && c.GW_LAB) {' 'if (false) {' test/api/config.test.ts
api_mutant "api: lab endpoints exist without GW_LAB"       src/routes/lab.ts "if (!config.lab) return reply.status(404).send({ error: 'lab_disabled' });" "if (false) return reply.status(404).send({ error: 'lab_disabled' });" test/api/lab.test.ts
# --- the alert rules --------------------------------------------------------------------------------------------------
rules_mutant "alert: AppDown can never fire"               'expr: up{job="app"} == 0' 'expr: up{job="app"} == 5'
rules_mutant "alert: a month-old backup is tolerated"      'time() - gw_last_backup_timestamp_seconds > 93600' 'time() - gw_last_backup_timestamp_seconds > 9360000'
rules_mutant "alert: a failed restore drill is not paged"  'expr: gw_last_drill_ok == 0' 'expr: gw_last_drill_ok == 7'
rules_mutant "alert: configuration drift is tolerated"     'expr: gw_config_drift_files > 0' 'expr: gw_config_drift_files > 100'
rules_mutant "alert: refused deploys need thirty to alert" '[10m]) >= 3' '[10m]) >= 30'

after="$(tree_hash)"
echo
echo "$total mutants: $killed killed, $survivors survived, $errors could not be run"
if [ "$before" != "$after" ]; then
  echo "THE SOURCE CHANGED while the mutants ran, and nothing in this script writes to it; somebody else did" >&2
  exit 2
fi
echo "the working tree was not touched"
[ "$survivors" -eq 0 ] && [ "$errors" -eq 0 ]
