# ADR 0001: Verify the copy, not the source

Status: Accepted

## Context
A release arrives as a directory with a `MANIFEST.sha256` that lists every file and its checksum. The deploy has to
decide that the files are the ones the manifest describes, and then run them. Between "decided" and "run" there is a
window, and anything that can write to the place the files sit in can use it.

## Decision
- **Copy first, then verify what was copied.** `deploy.sh` copies the package into the releases directory and checks the
  manifest against *that* copy. The files that were checked are the files that will run, because nothing else is ever
  started from the source directory.
- **The check goes both ways.** Every listed file must match its checksum (`a file does not match its checksum`), and no
  file may exist that the manifest does not list. The lab has a button for each: "Ship v1 with a file edited" and "Ship v1
  with an extra file". Both end in `artifact_unverified`, exit 10.
- **It is the first gate.** Nothing else runs on a package that failed it: the secrets file is not looked at, no migration
  is applied, no candidate is started. A refused package leaves no directory behind.
- **The manifest is built by `build-release.sh`, not by hand**, from the package's own files, sorted, so two builds of the
  same sources produce the same manifest.

## Rejected alternatives
- **Verify the source, then copy.** The classic check-then-use race: the file can change after the check and before the
  copy. It costs nothing to check afterwards, so there is no reason to accept the window.
- **Verify in place and run from the source.** The same race, held open for as long as the release runs.
- **Signatures (cosign, GPG) instead of a manifest.** A signature says *who* made the package; a manifest says *that it was
  not changed since the manifest was written*. They answer different questions, and only the second is needed to make the
  gate meaningful here. A signature belongs in front of this gate, not instead of it, and is the first item under
  "next" in the README.
- **Trusting the build** ("CI built it, so it is fine"). A green build is not a working release, and this gate is for the
  packages that left the build intact and arrived changed.

## Consequences
- (+) The tamper cases are tested twice: by `deploy.bats` against a real nginx, and by a mutant in `scripts/sabotage.sh`
  that removes the copy check and must turn those tests red.
- (−) The manifest travels with the package, so it proves the package was not changed *after* the manifest was written. It
  does not prove who wrote it. Said on the page and in the README.
- (−) A package is copied before it is trusted, so a hostile package is on disk for a moment. It is copied into a release
  directory that nothing is served from until the deploy commits it, and the exit trap removes it if any gate refuses.
