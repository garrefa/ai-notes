#!/usr/bin/env bash
# shellcheck shell=bash
#
# ledger-lock.sh — one lock for every writer of the notes repo's ledgers (PRS.md, TASKS.md, tasks/,
# daily/, INDEX.md). tools/check-prs.sh and the ledger-keeper agent both take it around their
# "edit the ledger + commit" step, so one can't overwrite the other's rows with a stale copy.
#
# The lock is the directory <notes_repo>/.ledger.lock, taken with an atomic `mkdir` (macOS has no
# flock by default). It holds an `owner` file: "<pid> <epoch seconds> <label>". A lock is stale, and
# the next taker removes it, when its owner pid (0 = unknown) is gone, or when it is older than
# LEDGER_LOCK_STALE_SECS (default 600) — which also covers an owner that never wrote a live pid
# (see `acquire` below). .ledger.lock/ is gitignored in the notes repo (see notes_gitignore_rules).
#
# Use it sourced (scripts) or as a command (agents):
#
#   source ledger-lock.sh
#   ledger_lock_acquire NOTES_REPO [LABEL]   # waits up to LEDGER_LOCK_WAIT_SECS (default 120); 0 = got it
#   ledger_lock_release NOTES_REPO
#
#   ledger-lock.sh acquire NOTES_REPO [LABEL]   # exit 0 = held; exit 1 = timed out (write nothing)
#   ledger-lock.sh release NOTES_REPO
#   ledger-lock.sh run NOTES_REPO LABEL -- CMD [ARGS...]   # acquire, run CMD, release; CMD's exit code
#
# Each `acquire`/`release` command is a separate process, so the pid it records is already dead when
# the next command runs: a lock taken that way expires after LEDGER_LOCK_STALE_SECS, or on `release`.
# Prefer `run` when the whole critical section fits in one command.

LEDGER_LOCK_NAME=".ledger.lock"

_ledger_lock_dir() { printf '%s/%s' "${1%/}" "$LEDGER_LOCK_NAME"; }

# True when the lock at $1 is held by nobody alive, or is too old to trust.
_ledger_lock_is_stale() {
  local dir="$1" pid="" taken="" now max
  max="${LEDGER_LOCK_STALE_SECS:-600}"
  read -r pid taken _ < "$dir/owner" 2>/dev/null || true
  now="$(date +%s)"
  # No readable owner yet: the taker is between mkdir and writing it — give it the full window.
  if [[ -z "$taken" ]]; then
    local mtime
    mtime="$(stat -f %m "$dir" 2>/dev/null || stat -c %Y "$dir" 2>/dev/null || echo "$now")"
    (( now - mtime > max )); return
  fi
  (( now - taken > max )) && return 0
  # pid 0 = taken by the `acquire` command, whose own pid is dead by design: it ages out instead.
  [[ "$pid" != 0 ]] && ! kill -0 "$pid" 2>/dev/null && return 0
  return 1
}

ledger_lock_acquire() {
  local notes_repo="$1" label="${2:-ledger-lock}" dir deadline
  dir="$(_ledger_lock_dir "$notes_repo")"
  deadline=$(( $(date +%s) + ${LEDGER_LOCK_WAIT_SECS:-120} ))
  while ! mkdir "$dir" 2>/dev/null; do
    if _ledger_lock_is_stale "$dir"; then
      # mv is atomic: of several takers racing for the same stale lock, exactly one moves it away.
      if mv "$dir" "$dir.stale.$$" 2>/dev/null; then
        rm -rf "$dir.stale.$$"
        echo "ledger-lock: removed a stale lock at $dir" >&2
      fi
      continue
    fi
    if (( $(date +%s) >= deadline )); then
      echo "ledger-lock: gave up waiting for $dir (held: $(cat "$dir/owner" 2>/dev/null || echo unknown))" >&2
      return 1
    fi
    sleep 1
  done
  printf '%s %s %s\n' "${LEDGER_LOCK_OWNER_PID:-$$}" "$(date +%s)" "$label" > "$dir/owner"
}

ledger_lock_release() {
  rm -rf "$(_ledger_lock_dir "$1")"
}

_ledger_lock_main() {
  local cmd="${1:-}"
  case "$cmd" in
    acquire)
      [[ $# -ge 2 ]] || { echo "usage: ledger-lock.sh acquire NOTES_REPO [LABEL]" >&2; return 2; }
      LEDGER_LOCK_OWNER_PID=0 ledger_lock_acquire "$2" "${3:-}" ;;
    release)
      [[ $# -ge 2 ]] || { echo "usage: ledger-lock.sh release NOTES_REPO" >&2; return 2; }
      ledger_lock_release "$2" ;;
    run)
      [[ $# -ge 5 && "$4" == "--" ]] || { echo "usage: ledger-lock.sh run NOTES_REPO LABEL -- CMD [ARGS...]" >&2; return 2; }
      local notes_repo="$2" label="$3" status=0
      shift 4
      ledger_lock_acquire "$notes_repo" "$label" || return 1
      # shellcheck disable=SC2064  # expand the path now
      trap "ledger_lock_release '$notes_repo'" EXIT
      "$@" || status=$?
      return "$status" ;;
    *)
      echo "usage: ledger-lock.sh acquire|release|run ... (see the header of this file)" >&2
      return 2 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  _ledger_lock_main "$@"
fi
