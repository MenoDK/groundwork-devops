# ADR 0005: A bash core with one line of JSON, and a typed API on top

Status: Accepted

## Context
The work the delivery machinery does is orchestration: run nginx, start and stop processes, call `pg_dump` and
`pg_restore`, copy and compare files, hold a lock. A person has to be able to run any step by hand on a server at 3 a.m.,
read what it did, and know whether it worked.

## Decision
- **The core is a set of small bash scripts** (`ops/`), `set -euo pipefail`, clean under `shellcheck`. Each one is a gate with
  a name and an exit code, prints what it did as `ok …` / `x …` lines, and ends with exactly one line,
  `RESULT {json}`, that says `ok`, `gate`, `result` and `message`.
- **Exit codes are part of the interface**: 10 to 17 for the deploy, 20 to 22 for backups, 30 to 33 for stages, 40 and 41 for
  the firewall. The same codes are in the history file, the API answers and the page.
- **Every script is tested against the real thing**: `bats` with a real nginx and a real PostgreSQL (57 tests), not mocks.
- **On top sits a small typed API** (Fastify 5, zod, TypeScript strict) that runs those scripts. It does not rebuild their
  logic: it validates the request, runs one script from an **allow-list through `execFile`, with no shell**, parses the
  `RESULT` line and returns it. It also serves the site, exports Prometheus metrics, and refuses a foreign `Host` or `Origin`.
- **The history is one JSONL file** that the scripts append to and the API reads. There is no database for the control plane.

## Rejected alternatives
- **All of it in TypeScript.** The wrapper around `nginx`, `pg_dump` and `flock` ends up larger and harder to run by hand
  than the scripts it replaces, and a person on a server has no `node` to hand.
- **Go or Rust binaries.** Fine tools; they would turn five readable files into a build, and the interesting logic is the
  order of the gates, which is easiest to read as a list.
- **Ansible.** A different tool for a fleet. Here the steps need a name, an exit code and a refusal path each, and the page
  needs to show them.
- **Python.** The same argument as TypeScript with a worse story for `flock` and process groups.

## Consequences
- (+) A reviewer can read `ops/deploy.sh` top to bottom and see the whole procedure; the lab shows the same lines.
- (+) `scripts/sabotage.sh` rewrites a line at a time and requires a test to go red. 40 of 40 are caught.
- (−) Bash has sharp edges (quoting, `set -e` in conditions, inherited file descriptors). Bugs found while building this
  were of that kind, and only running the real thing found them: a lock that outlived its deploy because a child process
  inherited file descriptor 9; a test helper that stopped nginx with `nginx -s stop`, which parses the very configuration
  the test had just broken and so hung; and a sabotage script that once left a mutated source file behind (it now works
  only on copies). All three are fixed.
- (−) Two languages. The seam between them is one line of JSON and an allow-list, which is the smallest seam there is.
