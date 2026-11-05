#!/usr/bin/env bash
# Database migrations for one artifact.
#
#   migrate.sh <artifact-dir> --check    exit 12 and list what is pending; changes nothing
#   migrate.sh <artifact-dir> --apply    apply what is pending, each file in its own transaction, in order
#
# The deploy script only ever calls --check. Applying a migration is a decision someone takes on purpose, before the
# release that needs it, so that the database credentials are not something a deploy pipeline holds.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

dir="${1:-}"
mode="${2:-}"
if [ -z "$dir" ] || { [ "$mode" != "--check" ] && [ "$mode" != "--apply" ]; }; then
  echo "usage: migrate.sh <artifact-dir> --check|--apply" >&2
  exit 2
fi
load_env || { echo "no $SHARED/app.env" >&2; exit 2; }

pending=()
shopt -s nullglob
files=("$dir"/migrations/*.sql)
shopt -u nullglob

have_table="$(psql "$DATABASE_URL" -tAc "select to_regclass('public.schema_migrations') is not null")"

for file in "${files[@]}"; do
  version="$(basename "$file" .sql)"
  # The version goes into SQL below. An artifact is input, so it has to look like a version before it is trusted.
  if ! [[ "$version" =~ ^[0-9]{4}_[a-z0-9_]+$ ]]; then
    echo "refusing a migration called '$version': names look like 0001_create_orders" >&2
    exit 2
  fi
  applied=""
  if [ "$have_table" = "t" ]; then
    applied="$(psql "$DATABASE_URL" -tAc "select 1 from schema_migrations where version = '$version'")"
  fi
  [ -n "$applied" ] || pending+=("$version")
done

if [ "$mode" = "--check" ]; then
  if [ "${#pending[@]}" -gt 0 ]; then
    echo "pending migrations: ${pending[*]}"
    echo "apply them first: migrate.sh $dir --apply"
    exit 12
  fi
  echo "no pending migrations"
  exit 0
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc \
  "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())"
for version in "${pending[@]}"; do
  echo "applying $version"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$dir/migrations/$version.sql" \
    -c "insert into schema_migrations (version) values ('$version')"
done
echo "applied ${#pending[@]} migration(s)"
