#!/usr/bin/env bash
#
# clean-merged-worktrees.sh — remove git worktrees whose branch is already
# merged, across every repo directly under a workspace root.
#
# Walks each repo one level under --root, finds its linked worktrees (i.e.
# every worktree beyond the repo's main checkout), and for each one:
#   - if the branch is merged and the worktree's working tree is clean, it's
#     a deletion candidate. "Merged" means either:
#       * the branch is an ancestor of the remote default branch (origin/HEAD,
#         falling back to origin/main, origin/master, or the local main/master
#         when the repo has no "origin" remote) — a regular merge; or
#       * GitHub has a merged PR for the branch whose head commit contains the
#         local branch tip — catches squash and rebase merges, which leave no
#         ancestry. Only checked when `gh` is installed; any gh failure just
#         means this check is skipped for that branch.
#   - stale registrations (the worktree's directory was already deleted from
#     disk) are reported as prunable
#
# Usage:
#   clean-merged-worktrees.sh [--root PATH] [--delete] [--no-fetch]
#
#   --root PATH   workspace directory whose immediate subdirectories are the
#                 repos to scan (default: the ainotes workspace root, found by
#                 walking up from the current directory until a directory
#                 containing .ai-notes/ turns up)
#   --delete      actually remove merged worktrees + their local branch, and
#                 prune stale worktree registrations (default: dry run only)
#   --no-fetch    skip "git fetch origin" per repo; compare against local refs
#
# Safety:
#   - Never touches a repo's main (first) worktree.
#   - Skips locked worktrees.
#   - Skips worktrees with uncommitted changes (dirty working tree).
#   - Skips worktrees whose branch is detached / not merged into the default branch.
#   - A branch whose PR was squash/rebase-merged is only treated as merged if
#     it has no local commits beyond that PR's head, so force-deleting it
#     (needed because git can't see the squash) never loses work.
#   - Without --delete, nothing on disk changes — it's a pure report.

set -euo pipefail

WORKSPACE_ROOT=""
DELETE=false
FETCH=true

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      WORKSPACE_ROOT="$2"
      shift 2
      ;;
    --root=*)
      WORKSPACE_ROOT="${1#--root=}"
      shift
      ;;
    --delete) DELETE=true; shift ;;
    --no-fetch) FETCH=false; shift ;;
    -h|--help)
      sed -n '2,39p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Walk up from $1 until a directory containing .ai-notes/ turns up; print it, or fail.
find_workspace_root() {
  local dir="$1"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -d "$dir/.ai-notes" ]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

if [ -z "$WORKSPACE_ROOT" ]; then
  WORKSPACE_ROOT="$(find_workspace_root "$PWD")" || {
    echo "No .ai-notes/ found above $PWD — run from inside an ainotes workspace or pass --root PATH." >&2
    exit 1
  }
fi

WORKSPACE_ROOT="$(cd "$WORKSPACE_ROOT" && pwd)"

echo "Root: $WORKSPACE_ROOT"
echo "Mode: $([ "$DELETE" = true ] && echo DELETE || echo DRY-RUN)  (fetch: $FETCH)"
echo

handle_worktree() {
  local path="$1" branch="$2" locked="$3" prunable="$4"

  if [ "$prunable" = true ]; then
    if [ "$DELETE" = true ]; then
      git -C "$REPO_DIR" worktree prune
      echo "  [$REPO_NAME] pruned stale worktree entry: $path"
    else
      echo "  [$REPO_NAME] would prune stale (dir already gone): $path"
    fi
    return
  fi

  if [ "$locked" = true ]; then
    echo "  [$REPO_NAME] SKIP (locked): $path [$branch]"
    return
  fi

  if [ -z "$branch" ]; then
    echo "  [$REPO_NAME] SKIP (detached HEAD): $path"
    return
  fi

  if ! git -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "  [$REPO_NAME] SKIP (branch ref not found): $path [$branch]"
    return
  fi

  local merged_via=""
  if git -C "$REPO_DIR" merge-base --is-ancestor "refs/heads/$branch" "$DEFAULT_REF" 2>/dev/null; then
    merged_via="ancestry"
  elif merged_pr_contains_tip "$branch"; then
    merged_via="pr"
  else
    echo "  [$REPO_NAME] not merged, keeping: $path [$branch]"
    return
  fi

  if [ ! -d "$path" ]; then
    echo "  [$REPO_NAME] SKIP (merged but path missing, run with --delete to prune): $path [$branch]"
    return
  fi

  if [ -n "$(git -C "$path" status --porcelain --ignore-submodules 2>/dev/null || true)" ]; then
    echo "  [$REPO_NAME] MERGED but dirty working tree, skipping: $path [$branch]"
    return
  fi

  if [ "$merged_via" = pr ]; then
    echo "  [$REPO_NAME] MERGED (via PR — squash/rebase): $path [$branch]"
  else
    echo "  [$REPO_NAME] MERGED: $path [$branch]"
  fi
  if [ "$DELETE" = true ]; then
    git -C "$REPO_DIR" worktree remove "$path"
    echo "    removed worktree"
    # A squash/rebase-merged branch isn't an ancestor of anything, so `-d`
    # would refuse it; merged_pr_contains_tip already proved its tip is in
    # the merged PR, so -D is safe there.
    local delete_flag=-d
    [ "$merged_via" = pr ] && delete_flag=-D
    if git -C "$REPO_DIR" branch "$delete_flag" "$branch" >/dev/null 2>&1; then
      echo "    deleted local branch $branch"
    fi
  fi
}

# Succeeds if GitHub has a merged PR for branch $1 whose head commit is (or
# contains) the local branch tip. Silently fails when gh is missing, the repo
# has no origin, or gh errors out (not authenticated, no network, etc.).
merged_pr_contains_tip() {
  local branch="$1" tip oid oids
  command -v gh >/dev/null 2>&1 || return 1
  git -C "$REPO_DIR" remote get-url origin >/dev/null 2>&1 || return 1
  oids="$(cd "$REPO_DIR" && gh pr list --head "$branch" --state merged \
    --json headRefOid -q '.[].headRefOid' 2>/dev/null)" || return 1
  [ -n "$oids" ] || return 1
  tip="$(git -C "$REPO_DIR" rev-parse "refs/heads/$branch")"
  for oid in $oids; do
    if [ "$oid" = "$tip" ] || git -C "$REPO_DIR" merge-base --is-ancestor "$tip" "$oid" 2>/dev/null; then
      return 0
    fi
  done
  echo "  [$REPO_NAME] note: $branch has a merged PR but local commits beyond it — not treating as merged"
  return 1
}

process_repo() {
  local wt_path="" wt_branch="" wt_locked=false wt_prunable=false
  local is_main=true

  flush() {
    [ -z "$wt_path" ] && return
    if [ "$is_main" = true ]; then
      is_main=false
    else
      handle_worktree "$wt_path" "$wt_branch" "$wt_locked" "$wt_prunable"
    fi
    wt_path=""; wt_branch=""; wt_locked=false; wt_prunable=false
  }

  while IFS= read -r line; do
    case "$line" in
      "worktree "*) flush; wt_path="${line#worktree }" ;;
      "branch "*) wt_branch="${line#branch refs/heads/}" ;;
      locked*) wt_locked=true ;;
      prunable*) wt_prunable=true ;;
      "") : ;;
    esac
  done < <(git -C "$REPO_DIR" worktree list --porcelain)
  flush
}

for repo_dir in "$WORKSPACE_ROOT"/*/; do
  repo_dir="${repo_dir%/}"
  [ -d "$repo_dir/.git" ] || continue

  REPO_DIR="$repo_dir"
  REPO_NAME="$(basename "$repo_dir")"

  echo "== $REPO_NAME =="

  if $FETCH; then
    git -C "$REPO_DIR" fetch --quiet origin >/dev/null 2>&1 || echo "  (fetch failed, using local refs)"
  fi

  if origin_head="$(git -C "$REPO_DIR" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)" \
    && git -C "$REPO_DIR" rev-parse --verify -q "$origin_head" >/dev/null; then
    DEFAULT_REF="$origin_head"
  elif git -C "$REPO_DIR" rev-parse --verify -q origin/main >/dev/null; then
    DEFAULT_REF="origin/main"
  elif git -C "$REPO_DIR" rev-parse --verify -q origin/master >/dev/null; then
    DEFAULT_REF="origin/master"
  elif git -C "$REPO_DIR" rev-parse --verify -q refs/heads/main >/dev/null; then
    DEFAULT_REF="refs/heads/main"
    echo "  no origin remote — using local branch 'main' as the merge target"
  elif git -C "$REPO_DIR" rev-parse --verify -q refs/heads/master >/dev/null; then
    DEFAULT_REF="refs/heads/master"
    echo "  no origin remote — using local branch 'master' as the merge target"
  else
    echo "  could not determine default branch (no origin/HEAD, origin/main, origin/master, or local main/master) — skipping repo"
    echo
    continue
  fi

  process_repo
  echo
done
