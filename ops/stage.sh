#!/usr/bin/env bash
# Changes to a machine that you can take back, one numbered stage at a time.
#
#   stage.sh list              the stages, and which are applied
#   stage.sh apply <NN>        back up what the stage touches, change it, then run the stage's own check
#   stage.sh revert <NN|--all> put every touched file back from its backup (newest first), then prove it
#
# Rules the stages obey (see ops/stages/): a stage calls `keep <file>` before it changes a file that exists and
# `created <file>` for one it makes, so the backup knows what undoing means. A stage whose own check fails reverts itself.
#
# Everything happens under $GW_SANDBOX (default: a small tree that stands in for /etc). Pointing it at / is a decision
# somebody has to make on purpose; this script never does.
#
# Exit codes: 0 ok | 2 usage | 30 unknown_stage | 31 verification_failed (and reverted) | 32 already_applied | 33 revert_not_exact
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

ROOT="${GW_SANDBOX:-$GW_ROOT/sandbox-root}"
STAGES="$GW_OPT/ops/stages"
BK="$GW_ROOT/backups/stages"
mkdir -p "$ROOT" "$BK"

stage_file() { # NN -> path, or exit 30
  local f
  for f in "$STAGES/$1"-*.sh; do
    if [ -e "$f" ]; then
      printf '%s' "$f"
      return 0
    fi
  done
  result_line false unknown_stage refused "no stage $1"
  say "x no stage $1"
  exit 30
}

# A path a stage names must stay inside the root: no "..", and always relative to it.
inroot() {
  case "$1" in
    /* | *..*) echo "refusing a path outside the root: $1" >&2; return 1 ;;
  esac
}

# The newest backup directory of a stage that has not been reverted (a reverted one is renamed *.reverted).
applied_dir() { # NN
  local d last=""
  for d in "$BK/$1"-*; do
    case "$d" in *.reverted) continue ;; esac
    [ -e "$d" ] && last="$d"
  done
  printf '%s' "$last"
}

# --- helpers a stage calls -------------------------------------------------------------------------------------------
BACKUP=""
keep() { # file (relative to the root)
  inroot "$1" || exit 2
  [ -f "$ROOT/$1" ] || return 0
  mkdir -p "$BACKUP/files/$(dirname "$1")"
  cp -a "$ROOT/$1" "$BACKUP/files/$1"
  printf 'modified %s %s\n' "$1" "$(sha256sum "$ROOT/$1" | awk '{print $1}')" >>"$BACKUP/manifest"
}
created() { # file (relative to the root)
  inroot "$1" || exit 2
  printf 'created %s -\n' "$1" >>"$BACKUP/manifest"
}

revert_dir() { # backup dir -> restores and proves; exit 33 if a restored file is not byte-for-byte what it was
  local dir="$1" kind path sum
  [ -f "$dir/manifest" ] || return 0
  tac "$dir/manifest" | while read -r kind path sum; do
    case "$kind" in
      modified) cp -a "$dir/files/$path" "$ROOT/$path" ;;
      created) rm -f "$ROOT/$path" ;;
    esac
  done
  while read -r kind path sum; do
    if [ "$kind" = modified ] && [ "$(sha256sum "$ROOT/$path" | awk '{print $1}')" != "$sum" ]; then
      result_line false revert_not_exact failed "$path is not what it was before the stage"
      say "x $path is not what it was before the stage"
      exit 33
    fi
  done <"$dir/manifest"
  mv "$dir" "$dir.reverted"
}

case "${1:-}" in
  list)
    for f in "$STAGES"/[0-9][0-9]-*.sh; do
      n="$(basename "$f" | cut -c1-2)"
      state="available"
      [ -n "$(applied_dir "$n")" ] && state="applied"
      title="$(sed -n 's/^title="\(.*\)"$/\1/p' "$f" | head -n 1)"
      printf '%s %-9s %s\n' "$n" "$state" "$title"
    done
    ;;

  apply)
    n="${2:-}"
    [[ "$n" =~ ^[0-9]{2}$ ]] || { echo "usage: stage.sh apply <NN>" >&2; exit 2; }
    f="$(stage_file "$n")"
    if [ -n "$(applied_dir "$n")" ]; then
      result_line false already_applied refused "stage $n is applied; revert it first"
      say "x stage $n is already applied"
      exit 32
    fi
    BACKUP="$BK/$n-$(date -u +%Y%m%dT%H%M%S)"
    mkdir -p "$BACKUP/files"
    : >"$BACKUP/manifest"
    # shellcheck disable=SC1090
    . "$f"
    say "==> stage $n: $title"
    # errexit does not work inside a function that is tested, so a stage separates its steps with `|| return 1`, and a
    # stage that stops half way is treated like one whose check failed: everything it touched goes back.
    why=""
    if ! apply; then
      why="the stage stopped before it finished"
    elif ! out="$(verify 2>&1)"; then
      why="${out:-the check failed}"
    fi
    if [ -n "$why" ]; then
      say "x the stage's own check failed: $why"
      say "==> putting it back"
      revert_dir "$BACKUP"
      event "stage-$n" "stage" "rolled_back" "verification failed: $why"
      result_line false verification_failed rolled_back "stage $n changed things and its own check failed ($why); everything was put back"
      exit 31
    fi
    event "stage-$n" "stage" "shipped" "applied and verified"
    say "ok stage $n applied and verified"
    result_line true stage applied "stage $n applied and verified"
    ;;

  revert)
    which="${2:-}"
    [ -n "$which" ] || { echo "usage: stage.sh revert <NN|--all>" >&2; exit 2; }
    if [ "$which" = "--all" ]; then
      dirs=""
      for d in "$BK"/[0-9][0-9]-*; do # newest first: stages are undone in the reverse order they were applied
        case "$d" in *.reverted) continue ;; esac
        [ -e "$d" ] && dirs="$d"$'\n'"$dirs"
      done
      dirs="${dirs%$'\n'}"
    else
      [[ "$which" =~ ^[0-9]{2}$ ]] || { echo "usage: stage.sh revert <NN|--all>" >&2; exit 2; }
      dirs="$(applied_dir "$which")"
    fi
    count=0
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      say "==> reverting $(basename "$d")"
      revert_dir "$d"
      count=$((count + 1))
    done <<<"$dirs"
    event "stages" "stage" "rolled_back" "reverted $count stage(s)"
    say "ok reverted $count stage(s); each file is byte-for-byte what it was"
    result_line true stage reverted "reverted $count stage(s)"
    ;;

  *)
    echo "usage: stage.sh list | apply <NN> | revert <NN|--all>" >&2
    exit 2
    ;;
esac
