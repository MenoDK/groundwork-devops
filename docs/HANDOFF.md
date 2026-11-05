# Handoff

Updated: 2026-11-05

Rewritten at the end of every session. A fresh session must be able to resume from disk alone.

## 1. What is live

Nothing is deployed. `make up` builds the image and starts three containers: one that plays "a server" (nginx, the control API
and the release processes), PostgreSQL and Prometheus. The site, the lab and the API are on http://localhost:8100, published on
the loopback only. The lab is on in that container; the control API refuses to start with the lab on when
`GW_ENV=production`.

## 2. Where we stopped

The delivery scripts, the control API, the landing page and lab in 14 languages, the browser tests, the smoke test, the mutation
check, the Terraform module, the Helm chart, the two workflows and the documentation are complete and verified locally
(section 8). The CI workflow ran on GitHub on 2026-11-05: the first run was red on one browser test (see section 7), the second
was green in all seven jobs (API, scripts with the alert rules, Terraform and Helm, mutation check, stack, browser, security). The manual
deploy workflow is written and `actionlint` is clean; it has never run, and nothing has been deployed to a host.

## 3. What the owner does now

1. Have native speakers read the thirteen translations in `site/i18n/` (written by the assistant; Hindi, Bengali, Urdu and Arabic most of all).
2. Decide whether to make the repository public.
3. If the manual deploy workflow is ever to be used: it does nothing unless the repository variable `DEPLOY_ENABLED` is `true`, and it also needs `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_KNOWN_HOSTS`. Read it before the first run: it has never touched a host.

## 4. Deadlines

None.

## 5. What NOT to do

- Do not add a script to the allow-list of the control API without a test that it is refused from outside the lab: [ADR 0005](adr/0005-a-bash-core-and-a-typed-api.md).
- Do not let a deploy read the package it was handed after it has been checked: the check is on the copy, and the copy is what runs: [ADR 0001](adr/0001-verify-the-copy-not-the-source.md).
- Do not make the live slot something other than a symlink that is switched in one step: [ADR 0002](adr/0002-two-slots-and-a-symlink.md).
- Do not call a backup good because `pg_dump` exited 0. It is good when it was restored into a scratch database and the row counts matched: [ADR 0003](adr/0003-a-backup-is-proven-by-restoring-it.md).
- Do not apply a stage without its revert, and do not drop the proof that the revert is byte for byte: [ADR 0004](adr/0004-changes-that-take-themselves-back.md).
- Do not turn the firewall script into one that applies rules until it can be tested against a live netfilter (checklist item 20): [ADR 0006](adr/0006-a-firewall-in-the-chain-docker-respects.md).
- Do not edit `site/transcripts.js` by hand. Change the behaviour, then run `make transcripts`; CI runs `--check`.
- Do not run `scripts/sabotage.sh` while editing `ops/`, `src/` or `prometheus/`: it works on copies, but it uses the same database and Compose project as the tests.
- Do not use a bare `ls` in this environment's shell (it is aliased and hangs); use `command ls`.
- Do not let the browser container create `docs/img` by itself: Docker makes a missing bind-mount source as root. `make e2e` creates it first.

## 6. Decisions

- Verifying the copy, the two slots, the restore drill, stages that revert, the bash core with a typed API, and the firewall chain: [ADR 0001](adr/0001-verify-the-copy-not-the-source.md) to [ADR 0006](adr/0006-a-firewall-in-the-chain-docker-respects.md).

## 7. Learned, not in the code

- These were found only by running the real stack, and none of them was caught by a unit test: the deploy lock was inherited by
  the process the deploy started, so the next deploy was refused for as long as that process lived (file descriptor 9); a test
  helper that ran `nginx -s stop` hung the suite; the mutation script contaminated its own later runs through a shared
  directory; and Prometheus could not scrape the control API because its Host check answered 403 to the service name
  `host`. The smoke test now fails if any scrape target is down.
- The first CI run was red on one browser test, and the cause was in the Makefile, not the page: `make e2e` did not ship a first
  release, so on a fresh stack `/app/version` answered 502 and the lab page logged it. Locally the stack already had a release,
  so it passed. Reproduced on a stack made with `make reset` (same output as CI), fixed by running `scripts/first-release.sh`
  in `make e2e` and `make screenshots`. Run the suite from `make reset` before trusting it.
- `scripts/first-release.sh` was not executable when first written, which would have broken `make up` on a fresh clone. Git
  must record mode 755 for it (`git ls-files -s scripts/first-release.sh`).
- The lab's "damaged copy" of a dump was never rotated, so copies piled up beside dumps that had been deleted. `rotate` now
  deletes the copy with its dump (test in `backup.bats`, mutant in `sabotage.sh`).
- The test "the drill leaves no scratch database behind" compares the count of scratch databases before and after instead of
  expecting none: the mutant that is written to leave one runs against the same server. `sabotage.sh` drops what that mutant
  leaves, and the stack was clean afterwards. A drill killed with SIGKILL would still leave its scratch database; that is not handled.
- One 502 was seen once, right after the very first deploy on a fresh volume, and not again in about 600 requests. The likely
  cause is the reload window of that first deploy. It is not proven (checklist item 22).
- A candidate that never becomes healthy is held for twenty seconds before it is refused. Browser tests that wait for the
  refusal use a 45-second timeout; a shorter one interrupts a deploy that is still running, and the next deploy gets exit 16.
- The recorded tour masks every timestamp (`\d{8}T\d{6}Z?`). An unmasked one makes `--check` fail on every run in CI.
- `kit.css`, `kit.js` and `i18n/ui.js` (the page chrome in 14 languages) are shared with the other showcase repositories; the
  canonical copy is in the first one and `scripts/sync-kit.sh` copies it. Change a shared style there, not here. The kit reads
  `#hash` only on load.

## 8. Suite state

Measured on 2026-11-05: 57 shell tests against a real nginx and a real PostgreSQL (`make test-ops`); 41 API tests (`vitest`);
`biome`, `tsc`, `shellcheck`, `promtool check` and `promtool test rules` (5 rules), `terraform fmt` and `validate`, and `helm lint`
with `kubeconform` clean; 40 of 40 mutants killed (`make sabotage`); 34 smoke checks against the running stack, one of them an
alert firing and clearing; 52 browser tests (`make e2e`: axe scans of the landing page and of each lab tab in both colour
schemes, 14 languages, every tab of the lab), plus 5 screenshot tests skipped unless `SHOTS=1`; the recorded tour matches the
stack (`--check`); `actionlint`, `hadolint` and `docsguard check` (9 rules, 0 findings) clean.
