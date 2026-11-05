#!/usr/bin/env bash
# Turns a variant from releases-src/ into an artifact: the app, the variant's own files, and a manifest of checksums.
#
#   build-release.sh <variant> <out-dir> [--tamper edit|add]
#
# --tamper changes the artifact AFTER the manifest was written, which is exactly what a swapped file in transit looks like.
# It exists for the lab and the tests; nothing else calls it.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

variant="${1:-}"
out="${2:-}"
tamper=""
[ "${3:-}" = "--tamper" ] && tamper="${4:-}"
if [ -z "$variant" ] || [ -z "$out" ]; then
  echo "usage: build-release.sh <variant> <out-dir> [--tamper edit|add]" >&2
  exit 2
fi
[[ "$variant" =~ ^[a-z0-9-]+$ ]] || { echo "bad variant name" >&2; exit 2; }
src="$GW_OPT/releases-src/$variant"
[ -d "$src" ] || { echo "unknown variant: $variant" >&2; exit 2; }

rm -rf "$out"
mkdir -p "$out/app"
cp -a "$src/." "$out/"
cp "$GW_OPT/app/server.mjs" "$out/app/server.mjs"
manifest="$(cd "$out" && find . -type f | sed 's|^\./||' | sort | xargs sha256sum)"
printf '%s\n' "$manifest" >"$out/MANIFEST.sha256"

case "$tamper" in
  "") ;;
  edit) printf '\n// injected after the manifest was written\n' >>"$out/app/server.mjs" ;;
  add) printf 'unexpected\n' >"$out/app/extra.mjs" ;;
  *) echo "unknown tamper: $tamper" >&2; exit 2 ;;
esac
echo "$out"
