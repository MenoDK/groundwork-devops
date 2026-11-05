# Master checklist

_What_ and _when_. The _how_ lives in the code and tests, the _why_ in the [ADRs](adr/README.md).

| #   | Item                                                                                          | Status  | Evidence                                                                                  |
| --- | --------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| 1   | Deploy: copy, verify the copy, secrets mode, migrations, health gate, `nginx -t`, edge check  | done    | [ADR 0001](adr/0001-verify-the-copy-not-the-source.md), `ops/deploy.sh`, `test/ops/deploy.bats` |
| 2   | Two slots and a symlink; rollback through the same gates; one deploy at a time               | done    | [ADR 0002](adr/0002-two-slots-and-a-symlink.md), 120 requests during a switch, all 200      |
| 3   | Backups proven by a restore drill; checksum and per-table row counts                         | done    | [ADR 0003](adr/0003-a-backup-is-proven-by-restoring-it.md), `ops/backup.sh`                 |
| 4   | Migrations: one transaction each, a release that needs one is refused until it has run       | done    | `ops/migrate.sh`, `test/ops/migrate.bats`                                                   |
| 5   | Alert rules with unit tests; both scrape targets verified up                                 | done    | `prometheus/rules.yml`, `prometheus/rules.test.yml`, `scripts/smoke.sh`                     |
| 6   | Configuration drift: modified, missing, extra; sync keeps a copy of what it replaced         | done    | `ops/drift.sh`, `test/ops/drift.bats`                                                       |
| 7   | Stages that run their own check, revert themselves, and prove the revert                     | done    | [ADR 0004](adr/0004-changes-that-take-themselves-back.md), `ops/stage.sh`                   |
| 8   | Control API: allow-listed scripts, no shell, Host and Origin checks, lab refused in production | done  | [ADR 0005](adr/0005-a-bash-core-and-a-typed-api.md), `src/`, `test/api/`                    |
| 9   | Firewall rules for the chain Docker respects (prints only)                                   | done    | [ADR 0006](adr/0006-a-firewall-in-the-chain-docker-respects.md), `ops/firewall-docker.sh`   |
| 10  | Landing page and lab in 14 languages; recorded tour with a drift check                       | done    | `site/`, `scripts/record-transcripts.mjs`                                                   |
| 11  | Mutation check of the gates                                                                  | done    | `scripts/sabotage.sh`, `make sabotage`                                                      |
| 12  | Container, health-gated Compose, smoke test                                                  | done    | `Dockerfile`, `docker-compose.yml`, `scripts/smoke.sh`                                      |
| 13  | Browser tests with accessibility scans                                                       | doing   | `e2e/`, `make e2e`                                                                          |
| 14  | CI workflow                                                                                  | written | `.github/workflows/ci.yml`: `actionlint` clean; not yet run on GitHub                       |
| 15  | Terraform module for an AWS host (new)                                                       | written | `infra/terraform/`: `fmt` and `validate` pass, never applied                                |
| 16  | Helm chart (new)                                                                             | written | `infra/helm/`: `lint`, `template` and `kubeconform` pass, never applied                     |
| 17  | Manual deploy workflow over SSH                                                              | written | `.github/workflows/deploy.yml`: `actionlint` clean, guarded by a repository variable, never run against a host |
| 18  | Apply the Terraform module to a real account                                                 | todo    | item 15                                                                                     |
| 19  | Run the stages in a VM against a real `/etc`                                                 | todo    | [ADR 0004](adr/0004-changes-that-take-themselves-back.md)                                   |
| 20  | Apply the firewall rules to a live netfilter and check from outside                          | todo    | [ADR 0006](adr/0006-a-firewall-in-the-chain-docker-respects.md)                             |
| 21  | Sign the package in front of the manifest check                                              | todo    | [ADR 0001](adr/0001-verify-the-copy-not-the-source.md)                                      |
| 22  | Supervise the live process; find the cause of the one 502 seen after the first-ever deploy   | todo    | [ADR 0002](adr/0002-two-slots-and-a-symlink.md)                                             |
| 23  | Off-site copies of backups and WAL archiving                                                 | todo    | [ADR 0003](adr/0003-a-backup-is-proven-by-restoring-it.md)                                  |
| 24  | ArgoCD on the Helm chart                                                                     | todo    | not built                                                                                   |
| 25  | Alertmanager and a pager for the five rules                                                  | todo    | not built                                                                                   |

Status is one of `todo`, `doing`, `done`, `written` (exists, not yet exercised where it will run), `dropped`.
A `done` row names the test or document that proves it. A row is never deleted when it is dropped: it is marked `dropped`
with the reason.
