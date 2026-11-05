#!/usr/bin/env bash
# Ships release 1.0.0 when nothing is live yet, so the first look at the lab shows a running system instead of an empty
# edge (and an AppDown alert that fires only because there is nothing to scrape). Does nothing when a release is live.
#
#   scripts/first-release.sh [base-url]        default http://localhost:8100
set -euo pipefail

A="${1:-http://localhost:8100}"

if [ "$(curl -fsS -m 10 "$A/api/overview" | jq -r '.live // empty | .release')" != "" ]; then
  echo "  a release is already live, leaving it alone"
  exit 0
fi
if [ "$(curl -fsS -m 10 "$A/api/health" | jq -r '.lab')" != "true" ]; then
  echo "  the lab is off on this server, so there is no endpoint to ship the first release with"
  exit 0
fi
result="$(curl -fsS -m 120 -X POST "$A/api/lab/ship" -H 'content-type: application/json' -d '{"variant":"v1"}')"
if [ "$(jq -r '.ok' <<<"$result")" = "true" ]; then
  echo "  shipped release 1.0.0"
else
  echo "  the first release was refused: $(jq -r '.message' <<<"$result")" >&2
  exit 1
fi
