#!/usr/bin/env bash
# Black-box check of the running stack: every gate, once, through the HTTP API, plus the alert going off and coming back.
#
#   scripts/smoke.sh [base-url]        default http://localhost:8100   (make up first)
#
# It leaves the server healthy and serving a release, so it can be run again.
set -uo pipefail

A="${1:-http://localhost:8100}"
n=0
pass() { n=$((n + 1)); printf '  ok %2d  %s\n' "$n" "$1"; }
die() { printf '  FAIL    %s\n' "$1" >&2; exit 1; }

post() { curl -sS -m 120 -X POST "$A$1" -H 'content-type: application/json' -d "${2:-{\}}"; }
get() { curl -sS -m 10 "$A$1"; }
edge() { curl -sS -m 3 "$A/app/version" | jq -r '.version // "none"'; }
# check <label> <json> <jq expression that must be true>
check() { printf '%s' "$2" | jq -e "$3" >/dev/null 2>&1 || die "$1  (got: $(printf '%s' "$2" | jq -c 'del(.steps)' 2>/dev/null | head -c 300))"; pass "$1"; }

settle() {
  post /api/lab/env-mode '{"mode":"600"}' >/dev/null
  post /api/lab/app '{"action":"start"}' >/dev/null 2>&1 || true
  post /api/lab/drift/sync >/dev/null
  post /api/lab/stages/health '{"value":"ok"}' >/dev/null
  post /api/lab/stages/revert '{"n":"all"}' >/dev/null
  post /api/lab/migrate '{"variant":"v4-orders-status"}' >/dev/null
}

echo "groundwork smoke test against $A"
settle

# --- the front door ------------------------------------------------------------------------------------------------------
check "health says the lab is on" "$(get /api/health)" '.ok == true and .lab == true'
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example.test' "$A/api/health")" = "403" ] || die "a foreign Host header was accepted"
pass "a foreign Host header is refused"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example.test' "$A/api/lab/rollback")" = "403" ] || die "a foreign Origin was accepted"
pass "a foreign Origin on a change is refused"

# --- shipping ------------------------------------------------------------------------------------------------------------
check "v1 ships"                                   "$(post /api/lab/ship '{"variant":"v1"}')" '.ok and .gate == "all"'
[ "$(edge)" = "1.0.0" ] || die "the edge does not serve 1.0.0"; pass "the edge serves v1"
check "v2 replaces v1"                             "$(post /api/lab/ship '{"variant":"v2"}')" '.ok'
[ "$(edge)" = "1.1.0" ] || die "the edge does not serve 1.1.0"; pass "the edge serves v2"
check "a release that cannot reach its database is refused (13)" "$(post /api/lab/ship '{"variant":"v3-no-database"}')" '.exitCode == 13 and .gate == "unhealthy" and .result == "refused"'
[ "$(edge)" = "1.1.0" ] || die "the refused release took traffic"; pass "the previous release kept serving"
check "an invalid nginx snippet is refused (14)"   "$(post /api/lab/ship '{"variant":"v5-bad-edge-config"}')" '.exitCode == 14 and .gate == "nginx_invalid"'
[ "$(edge)" = "1.1.0" ] || die "nginx served the bad snippet"; pass "nginx still serves the good configuration"
check "an edited artifact is refused (10)"         "$(post /api/lab/ship '{"variant":"v1","tamper":"edit"}')" '.exitCode == 10 and .gate == "artifact_unverified"'
check "an artifact with an extra file is refused (10)" "$(post /api/lab/ship '{"variant":"v1","tamper":"add"}')" '.exitCode == 10'
post /api/lab/env-mode '{"mode":"644"}' >/dev/null
check "a world-readable secrets file stops the deploy (11)" "$(post /api/lab/ship '{"variant":"v2"}')" '.exitCode == 11 and .gate == "env_permissions"'
post /api/lab/env-mode '{"mode":"600"}' >/dev/null
check "and the deploy works again once it is private" "$(post /api/lab/ship '{"variant":"v1"}')" '.ok'
[ "$(edge)" = "1.0.0" ] || die "the edge does not serve 1.0.0 after shipping v1"; pass "the edge serves v1 again"
# Rollback means "the most recent release on disk that is not the current one": here that is the v2 shipped earlier.
check "rollback ships the other release through the same gates" "$(post /api/lab/rollback)" '.ok and .gate == "rollback"'
[ "$(edge)" = "1.1.0" ] || die "rollback did not serve 1.1.0"; pass "the edge serves v2 again"

# --- the history ---------------------------------------------------------------------------------------------------------
check "every decision is on record" "$(get /api/deploys)" '(.events | map(.gate) | index("unhealthy")) != null and (.events | map(.gate) | index("nginx_invalid")) != null'
body="$(get /metrics)"
printf '%s' "$body" | grep -q '^gw_deploys_total{result="refused"} ' || die "metrics lack the refused counter"
pass "metrics count deploys by outcome"

# --- backups -------------------------------------------------------------------------------------------------------------
take="$(post /api/lab/backups/take)"
check "a backup is taken" "$take" '.ok'
file="$(get /api/backups | jq -r '[.backups[] | select(.damaged | not)][0].file')"
check "the restore drill proves it" "$(post /api/lab/backups/drill "{\"file\":\"$file\"}")" '.ok and .gate == "drill"'
damaged="$(post /api/lab/backups/damage "{\"file\":\"$file\"}" | jq -r '.file')"
check "a damaged copy fails its checksum (20)" "$(post /api/lab/backups/drill "{\"file\":\"$damaged\"}")" '.exitCode == 20 and .gate == "checksum_mismatch"'
check "rotation keeps what it was asked to" "$(post /api/lab/backups/rotate '{"keep":2}')" '.ok'

# --- drift ---------------------------------------------------------------------------------------------------------------
check "a fresh server matches the repository" "$(get /api/drift)" '.drifted == false'
post /api/lab/drift/edit '{"file":"systemd/groundwork-backup.timer","kind":"edit"}' >/dev/null
check "a hand edit is reported as drift" "$(get /api/drift)" '.drifted and (.files[0].state == "modified")'
check "sync puts it back" "$(post /api/lab/drift/sync)" '.ok'
check "and the server matches again" "$(get /api/drift)" '.drifted == false'

# --- changes that undo themselves ----------------------------------------------------------------------------------------
check "stage 01 applies and passes its own check" "$(post /api/lab/stages/apply '{"n":"01"}')" '.ok'
post /api/lab/stages/health '{"value":"bad"}' >/dev/null
check "a stage whose check fails reverts itself (31)" "$(post /api/lab/stages/apply '{"n":"03"}')" '.exitCode == 31 and .gate == "verification_failed"'
check "and is listed as not applied" "$(get /api/stages)" '(.stages | map(select(.n == "03"))[0].state) == "available"'
post /api/lab/stages/health '{"value":"ok"}' >/dev/null
check "everything can be reverted, and is proven" "$(post /api/lab/stages/revert '{"n":"all"}')" '.ok'

# --- alerting: the service dies, the alert fires, the service returns, the alert clears --------------------------------
firing() { get /api/alerts | jq -r '[.alerts[] | select(.name == "AppDown" and .state == "firing")] | length'; }
[ "$(get /api/alerts | jq -r '.available')" = "true" ] || die "Prometheus is not reachable"
# Both scrape targets must be up before the service is killed: a target that is down for another reason (a guard that
# refuses the scraper's Host header, for one) would make every rule that reads it silently useless.
down() { get /api/alerts | jq -r '[.targets[] | select(.health != "up") | .job] | join(",")'; }
for _ in $(seq 1 20); do [ -z "$(down)" ] && break; sleep 3; done
[ -z "$(down)" ] || die "Prometheus cannot scrape: $(down)"
post /api/lab/app '{"action":"stop"}' >/dev/null
for _ in $(seq 1 40); do [ "$(firing)" = "1" ] && break; sleep 3; done
[ "$(firing)" = "1" ] || die "AppDown did not fire within two minutes"
pass "stopping the service fires AppDown"
post /api/lab/app '{"action":"start"}' >/dev/null
for _ in $(seq 1 30); do [ "$(firing)" = "0" ] && break; sleep 3; done
[ "$(firing)" = "0" ] || die "AppDown did not clear"
pass "starting it again clears the alert"

echo "all $n checks passed"
