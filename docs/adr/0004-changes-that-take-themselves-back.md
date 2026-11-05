# ADR 0004: Changes that take themselves back

Status: Accepted

## Context
Hardening a machine is the riskiest routine change there is: it is small, it looks safe, and the failure is a locked
door or a service that no longer starts. A change needs to know what undoing it means *before* it is made, and needs a way
to find out, while the old state is still recoverable, that it broke something.

## Decision
- **Numbered stages.** Each file in `ops/stages/` is one change. A stage calls `keep <file>` before it alters a file that
  exists and `created <file>` for one it makes, so the backup records what "undo" means for each path.
- **A stage runs its own check, and a failing check reverts the stage.** `stage.sh apply NN` backs up, changes, then runs
  the stage's verification. If it fails the stage puts everything back and answers `verification_failed`, exit 31, with the
  reason. Stage 03 turns core dumps off and then asks the sample service whether it is still well; the lab has a button that
  makes the answer "no".
- **Reverting is proven.** `stage.sh revert` restores newest first and then compares each restored file with the checksum
  taken before the stage; if one is not byte for byte what it was, the answer is `revert_not_exact`, exit 33. A revert that
  cannot show it worked is a failure, not a quiet success.
- **A stage cannot be applied twice** (`already_applied`, exit 32), and a path outside the root is refused.
- **Everything happens under a sandbox root** (`GW_SANDBOX`) that stands in for `/etc`. Pointing it at `/` is a decision
  somebody has to make on purpose; no script does it.

## Rejected alternatives
- **Idempotent configuration management only (Ansible, Puppet).** Convergence tells you the end state, not how to get back
  to the one before. It is the right tool for a fleet and a different answer to a different question.
- **A VM or filesystem snapshot as the undo.** Coarse and slow, and it takes everything with it, including the data written
  since. A stage undoes one change.
- **Apply, then look.** The check belongs to the stage that knows what it broke, not to a person who has to remember it.
- **Trust the backup.** A restore that is not compared is the same hope as a backup that is not drilled
  ([ADR 0003](0003-a-backup-is-proven-by-restoring-it.md)).

## Consequences
- (+) Five behaviours have a mutant: the stage's own check is skipped, a revert is not proven, a path outside the root is
  accepted, a stage can be applied twice, and a revert does not put the file back.
- (−) **The sandbox is a directory, not a real `/etc`.** What is proven is the mechanism (back up, change, check, restore,
  compare), not the effect of these particular settings on a live host. The next step is a VM, and it is in the README.
- (−) A stage's own check is only as good as its author. The framework guarantees it runs and that its failure reverts; it
  cannot guarantee the check is the right one.
