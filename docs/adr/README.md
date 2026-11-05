# Decision records

Each record states the problem, what was chosen, **what was rejected and why**, and the cost that was accepted.

| # | Decision |
| --- | --- |
| [0001](0001-verify-the-copy-not-the-source.md) | Verify the copy, not the source |
| [0002](0002-two-slots-and-a-symlink.md) | Two slots and a symlink: the new release is proven beside the old one, then switched by a reload |
| [0003](0003-a-backup-is-proven-by-restoring-it.md) | A backup is proven by restoring it into a scratch database and comparing |
| [0004](0004-changes-that-take-themselves-back.md) | Changes that run their own check and take themselves back, and a revert that is itself verified |
| [0005](0005-a-bash-core-and-a-typed-api.md) | A bash core that prints one line of JSON, and a typed API on top |
| [0006](0006-a-firewall-in-the-chain-docker-respects.md) | A firewall in the chain Docker respects, that only prints |

A record is never rewritten to hide a reversal: a new record supersedes it and the old one says so
(`Superseded by: ADR NNNN`). Template and rules: the `adr` skill in `.claude/skills/adr/`.
