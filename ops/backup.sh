#!/usr/bin/env bash
# A backup is only a backup once somebody has restored it. This takes one, and proves one.
#
#   backup.sh take               dump the database, with a checksum and the row count of every table at that moment
#   backup.sh drill <dump>       restore it into a scratch database, compare, drop the scratch database
#   backup.sh rotate <keep>      keep the newest <keep> dumps and delete the rest
#   backup.sh list               the dumps, as JSON
#
# Exit codes: 0 ok | 2 usage | 20 checksum_mismatch | 21 rows_mismatch | 22 restore_failed
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

BK="$GW_ROOT/backups"
mkdir -p "$BK"
load_env || { echo "no $SHARED/app.env" >&2; exit 2; }
# The scratch database is addressed by replacing the database name at the end of the URL, so it must be a plain one.
[[ "$DATABASE_URL" =~ ^postgres(ql)?://[^?]+/[A-Za-z0-9_]+$ ]] || { echo "DATABASE_URL must end in /<database>, with no query string" >&2; exit 2; }

table_counts() { # url -> JSON object {table: rows}
  local url="$1" t n out="{}"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    n="$(psql "$url" -tAc "select count(*) from \"$t\"")"
    out="$(jq -c --arg t "$t" --argjson n "$n" '. + {($t): $n}' <<<"$out")"
  done < <(psql "$url" -tAc "select tablename from pg_tables where schemaname = 'public' order by 1")
  printf '%s' "$out"
}

verdict() { # ok gate result message exit-code
  say "$([ "$1" = true ] && echo ok || echo x) $2: $4"
  result_line "$1" "$2" "$3" "$4"
  exit "$5"
}

case "${1:-}" in
  take)
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    file="$BK/db-$stamp.dump"
    pg_dump "$DATABASE_URL" -Fc --no-owner -f "$file"
    (cd "$BK" && sha256sum "$(basename "$file")" >"$(basename "$file").sha256")
    jq -cn --arg file "$(basename "$file")" --arg taken_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --argjson bytes "$(stat -c %s "$file")" --argjson tables "$(table_counts "$DATABASE_URL")" \
      '{file: $file, taken_at: $taken_at, bytes: $bytes, tables: $tables}' >"$file.meta.json"
    event "database" "backup" "shipped" "$(basename "$file")"
    verdict true backup taken "$(basename "$file") ($(stat -c %s "$file") bytes)" 0
    ;;

  drill)
    file="${2:-}"
    [ -f "$file" ] || { echo "usage: backup.sh drill <dump>" >&2; exit 2; }
    meta="$file.meta.json"
    expected="$(awk '{print $1}' "$file.sha256" 2>/dev/null || true)"
    actual="$(sha256sum "$file" | awk '{print $1}')"
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
      event "database" "drill" "refused" "checksum_mismatch: $(basename "$file")"
      verdict false checksum_mismatch refused "$(basename "$file") does not match the checksum taken with it" 20
    fi

    scratch="drill_$(date +%s)_$$"
    scratch_url="${DATABASE_URL%/*}/$scratch"
    errors="$(mktemp)"
    # shellcheck disable=SC2317  # runs from the EXIT trap
    cleanup() {
      psql "$DATABASE_URL" -qc "drop database if exists \"$scratch\"" >/dev/null 2>&1 || true
      rm -f "$errors"
    }
    trap cleanup EXIT
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "create database \"$scratch\""
    if ! pg_restore --no-owner --exit-on-error -d "$scratch_url" "$file" 2>"$errors"; then
      event "database" "drill" "refused" "restore_failed: $(basename "$file")"
      verdict false restore_failed refused "pg_restore refused it: $(head -c 160 "$errors")" 22
    fi

    wrong=""
    if [ -f "$meta" ]; then
      restored="$(table_counts "$scratch_url")"
      wrong="$(jq -nr --argjson want "$(jq -c '.tables' "$meta")" --argjson got "$restored" \
        '$want | to_entries[] | select(($got[.key] // -1) != .value) | "\(.key): \($got[.key] // "missing") rows, expected \(.value)"')"
    fi
    if [ -n "$wrong" ]; then
      event "database" "drill" "refused" "rows_mismatch"
      verdict false rows_mismatch refused "the restore does not hold what was dumped ($(echo "$wrong" | head -n 1))" 21
    fi
    event "database" "drill" "shipped" "$(basename "$file") restored and compared"
    verdict true drill restored "$(basename "$file") restores, and every table has the rows it had" 0
    ;;

  rotate)
    keep="${2:-}"
    if ! [[ "$keep" =~ ^[0-9]+$ ]] || [ "$keep" -lt 1 ]; then
      echo "usage: backup.sh rotate <keep>   (keep at least 1)" >&2
      exit 2
    fi
    removed=0
    # newest first by modification time; everything after the first $keep goes
    while IFS= read -r old; do
      # the lab's "damaged copy" of a dump lives under the dump's own stamp; it goes with it, or it would be orphaned for good
      copy="$BK/damaged-$(basename "$old" | sed 's/^db-//')"
      rm -f "$old" "$old.sha256" "$old.meta.json" "$copy" "$copy.sha256" "$copy.meta.json"
      removed=$((removed + 1))
    done < <(find "$BK" -maxdepth 1 -name 'db-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2-)
    say "ok kept the newest $keep, removed $removed"
    result_line true rotate rotated "removed $removed"
    ;;

  list)
    shopt -s nullglob
    metas=("$BK"/db-*.dump.meta.json)
    if [ "${#metas[@]}" -eq 0 ]; then echo '[]'; else jq -cs 'sort_by(.file) | reverse' "${metas[@]}"; fi
    ;;

  *)
    echo "usage: backup.sh take | drill <dump> | rotate <keep> | list" >&2
    exit 2
    ;;
esac
