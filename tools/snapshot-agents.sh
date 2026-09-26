#!/usr/bin/env bash
#
# snapshot-agents.sh — standalone, AI-free snapshot of the Claude Code agents
# working in an ainotes workspace, written as AGENTS.json for the viewer's
# Agents view.
#
# Merges two local sources:
#   ~/.claude/sessions/<pid>.json   live processes (name, kind, idle/busy, cwd)
#   ~/.claude/jobs/<id>/state.json  background jobs, running or finished
#                                   (state, last status line, tokens, links)
# A background job and its session are joined on jobId; interactive sessions
# have no job and appear on their own. A session whose pid is no longer alive
# is reported with running=false instead of being dropped. An agent with
# neither a session activity (busy/idle) nor a job state (running/blocked/
# done) is dropped entirely — there's nothing to show, and leaving it in would
# default it to a misleading "idle".
#
# Only agents whose working directory is inside the workspace are kept, unless
# --all is given. The output is overwritten atomically on every run; it changes
# every minute, so keep it out of git (the notes-repo template ignores it).
# Schedule it with launchd or cron (every 60s suits it). Needs only `jq`.
#
# Usage:
#   snapshot-agents.sh [--all] [--verbose] [AGENTS.json path]
#
#   --all       keep every agent on this machine, not just this workspace's
#   --verbose   log each step to stderr
#
# The workspace is found by walking up (from the output path if given, else
# the current directory, else this script's own directory) until a directory
# containing .ai-notes/ turns up. The default output is the notes repo's root:
# <workspace>/<notes_repo>/AGENTS.json, or <notes_repo>/db/AGENTS.json for an
# older (pre-flattening) repo that still keeps its data under a db/ folder
# (the same rule the viewer uses).
#
# Exit status is 0 on success, non-zero only on a genuine failure to run.

set -euo pipefail

ALL_AGENTS=0
VERBOSE=0
OUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) ALL_AGENTS=1 ;;
    --verbose|-v) VERBOSE=1 ;;
    -h|--help)
      sed -n '2,36p' "$0"
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) OUT_FILE="$1" ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"

if [[ -n "$OUT_FILE" && -d "$(dirname "$OUT_FILE")" ]]; then
  WORKSPACE_ROOT="$(find_workspace_root "$(cd "$(dirname "$OUT_FILE")" && pwd)")" || WORKSPACE_ROOT=""
else
  WORKSPACE_ROOT="$(find_workspace_root "$PWD")" \
    || WORKSPACE_ROOT="$(find_workspace_root "$SCRIPT_DIR")" \
    || WORKSPACE_ROOT=""
fi

if [[ -z "$OUT_FILE" && -n "$WORKSPACE_ROOT" ]]; then
  NOTES_REPO="$(config_value "$WORKSPACE_ROOT/.ai-notes/config.yml" notes_repo 2>/dev/null || true)"
  NOTES_DIR="$WORKSPACE_ROOT/${NOTES_REPO:-notes}"
  if [[ -d "$NOTES_DIR/db" ]]; then OUT_FILE="$NOTES_DIR/db/AGENTS.json"; else OUT_FILE="$NOTES_DIR/AGENTS.json"; fi
fi

[[ -n "$OUT_FILE" ]] || { echo "No AGENTS.json path given and no .ai-notes/config.yml found above $PWD — pass the output path." >&2; exit 1; }
[[ -d "$(dirname "$OUT_FILE")" ]] || { echo "Output folder $(dirname "$OUT_FILE") does not exist." >&2; exit 1; }
[[ $ALL_AGENTS -eq 1 || -n "$WORKSPACE_ROOT" ]] || { echo "No ainotes workspace found above $OUT_FILE — pass --all to keep every agent." >&2; exit 1; }

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SESSIONS_DIR="$CLAUDE_DIR/sessions"
JOBS_DIR="$CLAUDE_DIR/jobs"

# Longest last-status line kept per agent; the full text stays in the job's timeline.
DETAIL_MAX_CHARS=280

log() { [[ $VERBOSE -eq 1 ]] && echo "[snapshot-agents] $*" >&2 || true; }

command -v jq >/dev/null 2>&1 || { echo "jq not found on PATH" >&2; exit 1; }

# Emits a JSON array (via stdin to jq -s) of every readable file matching the glob.
read_json_files() {
  local f
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    jq -c --arg file "$f" '. + {_file: $file}' "$f" 2>/dev/null || log "skipping unreadable $f"
  done | jq -s '.'
}

# Emits a JSON array of the pids (as numbers) from session files that are still running.
alive_pids() {
  local f pid
  for f in "$SESSIONS_DIR"/*.json; do
    [[ -f "$f" ]] || continue
    pid="$(basename "$f" .json)"
    kill -0 "$pid" 2>/dev/null && echo "$pid"
  done | jq -R 'tonumber' | jq -s '.'
}

SESSIONS="$(read_json_files "$SESSIONS_DIR"/*.json)"
JOBS="$(read_json_files "$JOBS_DIR"/*/state.json)"
ALIVE="$(alive_pids)"
PINS="$(jq -c '.' "$JOBS_DIR/pins.json" 2>/dev/null || echo '[]')"
log "read $(jq length <<<"$SESSIONS") session(s), $(jq length <<<"$JOBS") job(s)"

TMP_OUT="$(mktemp "${OUT_FILE}.XXXXXX")"
trap 'rm -f "$TMP_OUT"' EXIT

jq -n \
  --argjson sessions "$SESSIONS" \
  --argjson jobs "$JOBS" \
  --argjson alive "$ALIVE" \
  --argjson pins "$PINS" \
  --arg workspace "$WORKSPACE_ROOT" \
  --argjson allAgents "$ALL_AGENTS" \
  --arg host "$(hostname -s)" \
  --argjson detailMax "$DETAIL_MAX_CHARS" '
  def ms_to_iso: if . == null then null else (. / 1000 | floor | todateiso8601) end;
  def iso_seconds: if . == null then null else sub("\\.[0-9]+Z$"; "Z") end;
  def in_workspace: . != null and $workspace != "" and (. == $workspace or startswith($workspace + "/"));
  # The repo is the first folder under the workspace root; null for the root itself.
  # Outside the workspace (--all), it falls back to the folder name, skipping any worktree.
  def repo_of: if . == null or . == $workspace then null
    elif in_workspace then ltrimstr($workspace + "/") | split("/")[0]
    else split("/.claude/worktrees/")[0] | split("/")[-1] end;
  def worktree_of: if . == null then null
    else (capture("/\\.claude/worktrees/(?<w>[^/]+)") // {w: null}).w end;
  def clip: if . == null then null
    else tostring | gsub("\\s+"; " ") | if length > $detailMax then .[0:$detailMax] + "…" else . end end;

  ($sessions | map(select(.jobId != null) | {key: .jobId, value: .}) | from_entries) as $sessionByJob
  | ($jobs | map(.daemonShort // (._file | split("/")[-2]))) as $jobIds

  | def agent($job; $session):
      (($session.cwd // $job.cwd)) as $cwd
      | {
          id: ($job.daemonShort // $session.jobId // ("pid-" + ($session.pid | tostring))),
          name: ($session.name // $job.name),
          kind: ($session.kind // "bg"),
          running: ($session != null and ($alive | index($session.pid)) != null),
          activity: $session.status,
          state: $job.state,
          detail: ($job.detail | clip),
          pid: $session.pid,
          cwd: $cwd,
          repo: ($cwd | repo_of),
          worktree: ($cwd | worktree_of),
          tokens: $job.tokens,
          links: (($job.children // []) | map({kind, id, href} + (if .title then {title} else {} end))),
          pinned: (($pins | index($job.daemonShort // "")) != null),
          createdAt: (($job.createdAt | iso_seconds) // ($session.startedAt | ms_to_iso)),
          updatedAt: ([($job.updatedAt | iso_seconds), ($session.updatedAt | ms_to_iso)] | map(select(. != null)) | max),
          cliVersion: ($session.version // $job.cliVersion)
        };

  ( [ $jobs[] as $j | agent($j; $sessionByJob[$j.daemonShort // ($j._file | split("/")[-2])]) ]
    + [ $sessions[] | select(.jobId == null or (.jobId as $id | $jobIds | index($id) | not)) | agent(null; .) ]
    | map(select($allAgents == 1 or (.cwd | in_workspace)))
    # Neither source reported anything (no session activity, no job state) — nothing to show,
    # so drop it rather than have it default to a misleading "idle".
    | map(select(.activity != null or .state != null))
  ) as $agents
  | {
      generatedAt: (now | floor | todateiso8601),
      host: $host,
      workspace: (if $allAgents == 1 then null else $workspace end),
      summary: {
        total: ($agents | length),
        running: ($agents | map(select(.running)) | length),
        busy: ($agents | map(select(.running and .activity == "busy")) | length),
        idle: ($agents | map(select(.running and .activity == "idle")) | length),
        blocked: ($agents | map(select(.state == "blocked")) | length),
        done: ($agents | map(select(.state == "done")) | length),
        tokens: ($agents | map(.tokens // 0) | add // 0)
      },
      agents: ($agents | sort_by(.updatedAt // "") | reverse | sort_by(if .running then 0 else 1 end))
    }
' > "$TMP_OUT"

mv "$TMP_OUT" "$OUT_FILE"
trap - EXIT
log "wrote $OUT_FILE"
