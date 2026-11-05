# groundwork-devops

A small delivery pipeline you can break on purpose: bash gates for deploys, backups, drift and reversible changes, a typed
control API, nginx, PostgreSQL and Prometheus, all on localhost in Docker. One container plays "a server"; nothing leaves the
machine. The constraint that shapes everything: **every gate can refuse, a refusal leaves the previous state serving, and a
claim on the page is backed by a test.**

## Start here

- Map of every document: [docs/00-READ-FIRST.md](docs/00-READ-FIRST.md). Open a document only when the map says to.
- Resuming work: `docs/HANDOFF.md` first; rewrite it before you stop.
- Commands and definition of done: @AGENTS.md

## Layout

- `ops/`: the scripts. `deploy.sh`, `backup.sh`, `migrate.sh`, `drift.sh`, `stage.sh` (+ `stages/`), `firewall-docker.sh`,
  `build-release.sh`, `lib.sh`. Each ends with one `RESULT {json}` line and has an exit code per gate.
- `src/`: the control API (Fastify 5, zod, TypeScript strict). `test/api/` (vitest) and `test/ops/` (bats, real nginx and PostgreSQL).
- `site/`: landing page and lab UI, plain JS and CSS served by the API. `e2e/`: Playwright + axe.
- `prometheus/`: rules and their `promtool` unit tests. `releases-src/`: the five sample releases. `desired/`: the configuration the repository owns.
- `infra/`: Terraform and Helm, labelled new, validated and never applied. `scripts/`: `smoke.sh`, `sabotage.sh`, `record-transcripts.mjs`.

## Rules that apply to every task

1. **Verify the copy that will run, never the source.** See ADR 0001.
2. **A refusal leaves the previous release serving.** Gates run against a candidate on the idle slot before anything points at it. See ADR 0002.
3. **A backup counts once it was restored and compared.** See ADR 0003.
4. **A stage runs its own check, reverts itself on failure, and the revert is proven.** See ADR 0004.
5. **The API runs scripts from an allow-list through `execFile`, never a shell.** Do not add a route that builds a command line. See ADR 0005.
6. **The lab never reaches production, and the API refuses a foreign `Host` or `Origin`.** Do not weaken either to make a test pass.
7. **The firewall script prints and never applies.** See ADR 0006.
8. **Every new gate gets a `bats` test and a mutant in `scripts/sabotage.sh`.** A gate nothing notices is a gate that may be gone.
9. **Tests build their own secrets at run time** and use fictitious data only.
10. **The site loads nothing from another origin** (strict CSP). Do not edit `site/transcripts.js` by hand: `make transcripts`.
11. **Docs are code.** A new document is added to the map in the same commit; `docsguard check` must pass.

Advice versus enforcement: this file is advice. If `docsguard` is installed, `.claude/settings.json` turns the key rules into
hooks (destructive git is refused, and so are writes to secrets and keys).
