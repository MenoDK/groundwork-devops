# ADR 0003: A backup is proven by restoring it

Status: Accepted

## Context
`pg_dump` exiting 0 says it wrote a file. It does not say the file restores, that it is the file that was written, or that
the data in it is the data that was there. A backup that has never been restored is a hope.

## Decision
- **Taking a backup records three things**: the dump (`pg_dump -Fc`), its SHA-256 in a sidecar file, and the row count of
  every table in the running database at that moment.
- **The drill restores into a scratch database.** `backup.sh drill <file>` checks the checksum first
  (`checksum_mismatch`, exit 20), creates a throwaway database, runs `pg_restore --exit-on-error` into it
  (`restore_failed`, exit 22), compares every table's row count with the recorded one (`rows_mismatch`, exit 21), and drops
  the scratch database even when the comparison fails.
- **The checksum is checked before anything is restored**, so damage is reported as damage, not as a confusing restore error.
- **Damage is only ever done to a copy.** The lab's "Damage a copy" flips one byte in a *copy* of the file and lists it as a
  damaged copy; the original is never touched, so the demonstration cannot cost a real backup.
- **Rotation refuses to keep nothing.** `rotate 0` is a usage error, not a way to delete every backup.
- **The database URL must end in `/<database>` with no query string**, because the scratch database is addressed by
  replacing that name.
- **The alerts read the same facts.** `BackupStale` fires when the newest backup is older than 26 hours;
  `RestoreDrillFailing` fires while the last drill failed and clears when one succeeds.

## Rejected alternatives
- **Trust the exit code of `pg_dump`.** It proves the file was written.
- **A checksum alone.** It proves the file is the one that was written, not that what was written restores.
- **Restore into the live database to test it.** Not a test; an incident.
- **Compare content hashes of every table.** Stronger than row counts, and slow enough on a real database that nobody would
  run it often. Row counts catch a truncated or partial restore, which is the failure that actually happens.

## Consequences
- (+) Each comparison has a test and a mutant that removes it (checksum, rows, scratch database left behind).
- (−) Row counts do not prove the *content* of a row. A restore that changed values and kept the count would pass.
- (−) The dump sits on the same volume as the database it protects. This is a demonstration of the proof, not of off-site
  storage; the README lists it.
- (−) A dump is a point in time. There is no WAL archiving, so there is no point-in-time recovery.
