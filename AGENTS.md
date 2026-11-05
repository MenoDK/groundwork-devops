# Agent contract

Tool-neutral: what any engineer or coding agent needs to work here without asking.

## Commands

| Task                                                                | Command                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Start the server, PostgreSQL and Prometheus with the lab on         | `make up` (then http://localhost:8100); `make down` to stop; `make reset` to wipe data    |
| Biome and the TypeScript compiler                                   | `make lint`                                                                              |
| The control API's tests                                             | `make test-api`                                                                          |
| The shell scripts' tests (real nginx, real PostgreSQL)              | `make test-ops`                                                                          |
| The alert rules' unit tests                                         | `make test-rules`                                                                        |
| shellcheck on every script                                          | `make lint-sh`                                                                           |
| Terraform `fmt`/`validate`, Helm `lint`/`template`, `kubeconform`   | `make validate-iac`                                                                      |
| All of the above                                                    | `make check`                                                                             |
| Thirty-four checks against the running stack                        | `make smoke`                                                                             |
| Browser tests and accessibility scans                               | `make e2e` (Playwright in a container, against the real container)                       |
| Break each gate on purpose and confirm a test notices               | `make sabotage` (works on copies; the working tree is not touched)                       |
| Re-record the page's sample output                                  | `make transcripts` (needs the stack running with the lab on)                             |
| Documentation guards                                                | `docsguard check`                                                                        |

## Definition of done

1. A test covers it and fails without the change; a gate gets an adversarial test (try to break it) and a mutant in
   `scripts/sabotage.sh`.
2. `make check` passes and you can quote its output; anything that touches a file, a process or a socket runs against the real thing.
3. An ADR exists for any decision a newcomer would have to reverse-engineer, with the rejected alternatives.
4. `docs/HANDOFF.md` carries the numbers that were printed, not the ones that were expected.

## Boundaries

- Do not weaken a gate, the Host and Origin checks, the production refusal of the lab, or the allow-list to make a test pass.
- Ask before adding a dependency or changing a route, an exit code or an environment variable.
- Anything outside the task goes into `docs/CHECKLIST.md`, not into this change.

## Reporting

Say what happened, not what was expected. A failing test, a skipped check or an unverified claim goes in the report
as it is. Retractions are written down, not quietly dropped.
