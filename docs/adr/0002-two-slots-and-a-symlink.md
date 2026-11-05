# ADR 0002: Two slots and a symlink

Status: Accepted

## Context
A deploy has to replace the release that is serving without a gap, and it has to be able to change its mind at any step
before the replacement is real. Restarting the process in place gives a gap and no way back.

## Decision
- **Two ports, one idle at any time.** The sample service runs on slot 4101 or 4102. The candidate is started on the idle
  slot, beside the release that is serving, and the file `run/live-slot` says which one is live.
- **Gates run against the candidate before anything points at it**, in this order: the package verifies
  ([ADR 0001](0001-verify-the-copy-not-the-source.md)), the secrets file is mode 600, no migration is pending, the candidate
  answers `/healthz` *with the version the package claims* (twenty seconds, then `unhealthy`, exit 13), and nginx accepts the
  new configuration (`nginx -t`, then `nginx_invalid`, exit 14).
- **The switch is a reload.** Only after those gates does the deploy write the new upstream, reload nginx (workers finish
  their requests, new ones go to the new slot) and ask the *edge* what it serves. If the edge does not answer with the
  new version within ten seconds the previous upstream is restored (`edge_verification_failed`, exit 15).
- **Commit last.** `current` is a symlink to the release directory, moved only after the edge is verified. Then the old slot
  drains (`GW_DRAIN`) and stops. Pruning keeps the newest `GW_KEEP` releases and never the one in service.
- **Rollback is a deploy.** It picks the newest release directory that is not the current one and sends it through the same
  gates, so a rollback to something that no longer starts is refused like any other deploy.
- **One deploy at a time.** A `flock` on file descriptor 9 answers a second deploy with `deploy_in_progress`, exit 16.
  Child processes started by the deploy close that descriptor (`9>&-`), or the lock would outlive the deploy.

## Rejected alternatives
- **Restart in place.** A gap for every deploy, and a failed start is an outage. The whole point is that a refusal leaves
  the old release serving.
- **A process manager (systemd, pm2, supervisord).** It would add supervision: restarting a process that crashed. That is
  useful and absent here on purpose, because the lab's "Stop the live process" then shows what unsupervised looks like
  (nginx answers 502, `AppDown` fires). The cost is written in the README: on a real host the process wants a supervisor.
- **A second nginx upstream with weights, or a service mesh.** More moving parts to express "one of two".
- **Container-level blue/green.** The same idea one layer up; it would hide the steps this repository exists to show.

## Consequences
- (+) Every gate has a test against a real nginx and a real PostgreSQL, and a mutant that removes it. A test sends 120
  requests while a release replaces another and requires every one to be a 200.
- (−) **The first release is not covered by that guarantee.** There is nothing to replace, and the edge starts pointing at a
  placeholder upstream. One unexplained 502 was seen right after the very first deploy and was not reproduced in about 600
  requests; the likeliest cause is the reload window of that first deploy, which has not been proven.
- (−) Two slots are two processes' worth of memory for the length of a deploy.
- (−) Nothing restarts a crashed release. See above.
