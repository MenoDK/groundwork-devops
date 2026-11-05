#!/usr/bin/env bash
# The repository says one thing and the server does another, and nothing complains. This makes it complain.
#
#   drift.sh check    compare the live configuration with the one the repository owns; exit 1 when they differ
#   drift.sh sync     put the repository's version back, keeping a copy of every file it replaces or removes
#
# A file is `modified` (same path, different bytes), `missing` (the repository has it, the server does not) or `extra`
# (the server has it, the repository never heard of it).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

DESIRED="$GW_OPT/desired"
LIVE="$GW_ROOT/live-config"
mkdir -p "$LIVE"

list() { (cd "$1" && find . -type f | sed 's|^\./||' | sort); }

# Lines of "<state> <path>", nothing for a file that matches.
differences() {
  local f
  while IFS= read -r f; do
    if [ ! -f "$LIVE/$f" ]; then
      echo "missing $f"
    elif ! cmp -s "$DESIRED/$f" "$LIVE/$f"; then
      echo "modified $f"
    fi
  done < <(list "$DESIRED")
  while IFS= read -r f; do
    [ -f "$DESIRED/$f" ] || echo "extra $f"
  done < <(list "$LIVE")
}

report() {
  jq -R -s -c 'split("\n") | map(select(length > 0) | split(" ") | {state: .[0], path: .[1]})' <<<"$1"
}

case "${1:-}" in
  check)
    diffs="$(differences)"
    if [ -z "$diffs" ]; then
      say "ok the server matches the repository"
      result_line true drift clean "no differences"
      exit 0
    fi
    say "x the server differs from the repository:"
    printf '  %s\n' "$diffs"
    result_line false drift drifted "$(wc -l <<<"$diffs" | tr -d ' ') file(s) differ" "" "$(report "$diffs")"
    exit 1
    ;;

  sync)
    diffs="$(differences)"
    if [ -z "$diffs" ]; then
      say "ok nothing to do"
      result_line true drift clean "no differences"
      exit 0
    fi
    kept="$GW_ROOT/backups/drift-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$kept"
    while read -r state path; do
      case "$state" in
        modified | extra)
          mkdir -p "$kept/$(dirname "$path")"
          cp -a "$LIVE/$path" "$kept/$path"
          ;;
      esac
      case "$state" in
        modified | missing)
          mkdir -p "$LIVE/$(dirname "$path")"
          install -m 0644 "$DESIRED/$path" "$LIVE/$path"
          say "  $state $path -> restored from the repository"
          ;;
        extra)
          rm -f "$LIVE/$path"
          say "  $state $path -> removed (a copy is kept)"
          ;;
      esac
    done <<<"$diffs"
    event "config" "drift" "shipped" "synced $(wc -l <<<"$diffs" | tr -d ' ') file(s); copies in $(basename "$kept")"
    say "ok the server matches the repository again; what was replaced is in $kept"
    result_line true drift synced "fixed $(wc -l <<<"$diffs" | tr -d ' ') file(s); copies kept in $(basename "$kept")"
    ;;

  *)
    echo "usage: drift.sh check | sync" >&2
    exit 2
    ;;
esac
