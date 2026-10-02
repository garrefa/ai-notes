#!/usr/bin/env bash
#
# dm-pr-review.sh — headless Claude code review of a GitHub PR, posted as you (the
# ainotes-dm-pr-review skill).
#
# Checks the PR out in a private clone cache, runs Claude Code's built-in `/code-review` skill on it
# headlessly (`claude -p`, read-only tools, no MCP), and publishes the structured result as you:
# an approval (the review summary as its body) when there are zero findings, otherwise a
# non-blocking inline COMMENT review. A PR already reviewed at its current commit, or approved by
# you there, is skipped. Every model call's cost and tokens land in a ledger. The monthly cap in
# config.yml is checked before each review and passed down as --max-budget-usd, so it can't be
# overrun. Each published review is filed as a note in <notes_repo>/reviews/ via review-note.sh
# (ainotes-review-notes).
#
# Usually driven by `check-pending-pr-reviews --review`, which only calls this when PRs are pending, so
# an empty queue costs $0.
#
# Usage: dm-pr-review.sh <command>
#   review <pr-url> [--dry-run]  review one PR and post the result to GitHub (--dry-run posts nothing)
#   dry-run <pr-url>             same as review --dry-run (cost still counts)
#   spend [YYYY-MM]              spend summary for a month (default: current)
#   status                       config summary and this month's spend
#
# Settings are the `dm_pr_review:` section of the ainotes config (<notes repo>/.config.yml, found
# by walking up from the current directory, else this script's directory; see ainotes-config.sh):
# self_github_login (default: `gh api user`), review_model (opus), review_level (high),
# per_review_budget_usd (8) and monthly_budget_usd (100). The spend ledger is
# <notes repo>/pr-reviews-ledger.jsonl, tracked and committed after every recorded call. Local state
# lives in the gitignored <notes repo>/.state/dm-pr-review/: state.json, review.log, repos/ (clone
# cache) and run/. Needs `claude` (Claude Code), `gh` (authenticated), `git` and `jq` on PATH. It is
# bash 3.2-safe.
#
# Exit status: 0 when the review was done or skipped, 3 when the monthly budget is spent, 1 on failure.

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"
CONFIG="$(find_ainotes_config "$PWD" || find_ainotes_config "$SCRIPT_DIR" || true)"
[[ -n "$CONFIG" ]] || { echo "No ainotes config (<notes repo>/.config.yml) found above $PWD or $SCRIPT_DIR." >&2; exit 1; }
WORKSPACE="$(workspace_root_of "$CONFIG")"
NOTES_DIR="$(notes_dir_of "$CONFIG")"
[[ -n "$NOTES_DIR" && -d "$NOTES_DIR" ]] || { echo "Notes repo not found for $CONFIG." >&2; exit 1; }
STATE_DIR="$NOTES_DIR/.state/dm-pr-review"
LEDGER_REL="pr-reviews-ledger.jsonl"          # relative to the notes repo (tracked), for git
OLD_LEDGER_REL=".dm-pr-review/ledger.jsonl"   # where it used to be tracked
STATE="$STATE_DIR/state.json"
LEDGER="$NOTES_DIR/$LEDGER_REL"
LOG="$STATE_DIR/review.log"
RUN_DIR="$STATE_DIR/run"
REPO_CACHE="$STATE_DIR/repos"
LOCK_DIR="$STATE_DIR/.lock"
PROMPT="$SCRIPT_DIR/dm-pr-review.prompt.md"
SCHEMA="$SCRIPT_DIR/dm-pr-review.schema.json"

MIN_REVIEW_BUDGET_USD=1   # don't start a review with less than this left in the month

# The reviewer is read-only: it may read the checkout and the PR, never post or push. The script
# itself posts the GitHub review from the structured output. (One argv element per pattern — the
# patterns contain spaces.)
REVIEW_ALLOWED_TOOLS=(Read Grep Glob Skill Agent ToolSearch ReportFindings
  "Bash(git diff *)" "Bash(git log *)" "Bash(git show *)" "Bash(git blame *)" "Bash(git merge-base *)"
  "Bash(git rev-parse *)" "Bash(gh pr view *)" "Bash(gh pr diff *)" "Bash(gh pr checks *)")
REVIEW_DENIED_TOOLS=(Edit Write NotebookEdit WebFetch WebSearch
  "Bash(gh pr review *)" "Bash(gh pr comment *)" "Bash(gh pr merge *)" "Bash(gh api *)" "Bash(git push *)")

# ---------------------------------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------------------------------

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
die() { echo "error: $*" >&2; log "error: $*"; exit 1; }
# cfg KEY — a setting from the config's `dm_pr_review:` section, or its default
cfg() {
  local v; v="$(config_value "$CONFIG" dm_pr_review "$1")"
  if [[ -n "$v" ]]; then echo "$v"; return; fi
  case "$1" in
    self_github_login) [[ -n "${GH_LOGIN_CACHE:-}" ]] || GH_LOGIN_CACHE="$(gh api user -q .login 2>/dev/null || true)"
                       echo "$GH_LOGIN_CACHE" ;;
    review_model) echo opus ;;
    review_level) echo high ;;
    per_review_budget_usd) echo 8 ;;
    monthly_budget_usd) echo 100 ;;
  esac
}

# Float comparison: float_ge a b  ->  a >= b
float_ge() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a >= b) }'; }
float_min() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", (a < b ? a : b) }'; }

ensure_state() {
  mkdir -p "$STATE_DIR" "$RUN_DIR" "$REPO_CACHE"
  [[ -f "$STATE" ]] || echo '{"reviews":{}}' > "$STATE"
  touch "$LEDGER" "$LOG"
  ensure_gitignore
}

# The state dir holds private clones and logs: make sure the notes repo ignores .state/
# (install.sh applies the same rules; this covers a repo set up some other way).
ensure_gitignore() {
  local gi="$NOTES_DIR/.gitignore" updated
  updated="$(notes_gitignore_updated "$gi")"
  [[ "$updated" == "$(cat "$gi" 2>/dev/null)" ]] || printf '%s\n' "$updated" > "$gi"
}

# commit_ledger MESSAGE — commit just the ledger to the notes repo (no-op outside git or if unchanged)
commit_ledger() {
  git -C "$NOTES_DIR" rev-parse --git-dir >/dev/null 2>&1 || return 0
  local paths=("$LEDGER_REL")
  # First commit after the ledger moved: record the old tracked path's removal in the same commit.
  if [[ ! -e "$NOTES_DIR/$OLD_LEDGER_REL" ]] \
     && git -C "$NOTES_DIR" ls-files --error-unmatch -- "$OLD_LEDGER_REL" >/dev/null 2>&1; then
    git -C "$NOTES_DIR" rm -q --cached -- "$OLD_LEDGER_REL" >>"$LOG" 2>&1 && paths+=("$OLD_LEDGER_REL")
  fi
  git -C "$NOTES_DIR" add -- "$LEDGER_REL" >>"$LOG" 2>&1 || return 0
  git -C "$NOTES_DIR" diff --cached --quiet -- "${paths[@]}" && return 0
  git -C "$NOTES_DIR" commit -q -m "$1" -- "${paths[@]}" >>"$LOG" 2>&1 \
    || log "ledger commit failed (left uncommitted)"
}

# state_get <jq filter> [jq args...]
state_get() { local f=$1; shift; jq -r "$@" "$f // empty" "$STATE"; }
# state_update <jq filter> [jq args...] — atomic rewrite of state.json
state_update() {
  local f=$1; shift
  jq "$@" "$f" "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"; trap 'rm -rf "$LOCK_DIR"' EXIT; return 0
  fi
  local pid; pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then return 1; fi
  rm -rf "$LOCK_DIR"; acquire_lock
}

# ---------------------------------------------------------------------------------------------------
# Budget and ledger
# ---------------------------------------------------------------------------------------------------

month_spend() {
  local month=${1:-$(date +%Y-%m)}
  jq -s -r --arg m "$month" '[.[] | select(.month == $m) | .cost_usd] | add // 0 | . * 100 | round / 100' "$LEDGER"
}

remaining_budget() { awk -v cap="$(cfg monthly_budget_usd)" -v s="$(month_spend)" 'BEGIN { printf "%.2f", cap - s }'; }

# record_spend <kind> <user> <pr> <sha> <result> <claude-json-file>
record_spend() {
  jq -c -n --arg ts "$(date -u +%FT%TZ)" --arg month "$(date +%Y-%m)" \
    --arg kind "$1" --arg user "$2" --arg pr "$3" --arg sha "$4" --arg result "$5" \
    --slurpfile out "$6" '
    ($out[0] // {}) as $o | {
      ts: $ts, month: $month, kind: $kind, user: $user, pr: $pr, sha: $sha, result: $result,
      cost_usd: ($o.total_cost_usd // 0), turns: ($o.num_turns // 0),
      tokens: {
        input: ($o.usage.input_tokens // 0), output: ($o.usage.output_tokens // 0),
        cache_read: ($o.usage.cache_read_input_tokens // 0),
        cache_creation: ($o.usage.cache_creation_input_tokens // 0)
      }
    }' >> "$LEDGER"
  commit_ledger "dm-pr-review ledger: $1 ${3##*github.com/} ($5)"
}

# ---------------------------------------------------------------------------------------------------
# Model calls (each isolated: neutral cwd, no MCP servers, no session persistence, dontAsk)
# ---------------------------------------------------------------------------------------------------

# claude_call <cwd> <model> <budget> <schema-file> <prompt> [extra claude args...] — prints JSON
claude_call() {
  local cwd=$1 model=$2 budget=$3 schema=$4 prompt=$5; shift 5
  (cd "$cwd" && claude -p "$prompt" --model "$model" --max-budget-usd "$budget" \
    --strict-mcp-config --no-session-persistence --permission-mode dontAsk \
    --output-format json --json-schema "$(cat "$schema")" "$@" 2>>"$LOG") || true
}

render_prompt() { # render_prompt <file> KEY=value ... — replaces {{KEY}} (jq: bash 3.2-safe, no escaping issues)
  local file=$1 kv args=(); shift
  for kv in "$@"; do args+=(--arg "${kv%%=*}" "${kv#*=}"); done
  jq -rn --rawfile t "$file" "${args[@]}" \
    'reduce ($ARGS.named | to_entries[]) as $e ($t; gsub("\\{\\{" + $e.key + "\\}\\}"; $e.value))'
}

# ---------------------------------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------------------------------

pr_parts() { # pr_parts <url> -> "owner repo number"
  sed -E 's#https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+).*#\1 \2 \3#' <<<"$1"
}

pr_info() {
  gh pr view "$1" --json state,isDraft,headRefOid,headRefName,baseRefName,title,author,reviews,additions,deletions,changedFiles,statusCheckRollup 2>>"$LOG"
}

# i_approved_at <pr-json> <sha> -> exit 0 if my latest review on this commit is an approval
i_approved_at() {
  jq -e --arg me "$(cfg self_github_login)" --arg sha "$2" '
    [.reviews[] | select(.author.login == $me and .commit.oid == $sha)] | last | .state == "APPROVED"
  ' <<<"$1" >/dev/null 2>&1
}

# Detached worktree of the PR head in a private clone cache (never touches your own checkouts).
# Called in `||` context, where set -e is off — so every step returns explicitly.
prepare_checkout() {
  local owner=$1 repo=$2 num=$3 sha=$4 base=$5
  local clone="$REPO_CACHE/$owner/$repo" wt="$RUN_DIR/review-$repo-$num-${sha:0:7}"
  if [[ ! -d "$clone/.git" ]]; then
    mkdir -p "$REPO_CACHE/$owner" || return 1
    gh repo clone "$owner/$repo" "$clone" -- --filter=blob:none --quiet >>"$LOG" 2>&1 || return 1
  fi
  git -C "$clone" fetch --quiet origin "$base" "pull/$num/head" >>"$LOG" 2>&1 || return 1
  rm -rf "$wt"; git -C "$clone" worktree prune
  git -C "$clone" worktree add --quiet --detach "$wt" "$sha" >>"$LOG" 2>&1 || return 1
  printf '%s' "$wt"
}

cleanup_checkout() { local owner=$1 repo=$2 wt=$3
  git -C "$REPO_CACHE/$owner/$repo" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
}

# post_github_review <url> <sha> <review-json> — approve on zero findings, else inline COMMENT review
post_github_review() {
  local url=$1 sha=$2 review=$3 owner repo num count summary body
  read -r owner repo num <<<"$(pr_parts "$url")"
  count=$(jq '.findings | length' <<<"$review")
  summary=$(jq -r '.summary' <<<"$review")
  if (( count == 0 )); then
    body=$summary
    gh pr review "$url" --approve --body "$body" >>"$LOG" 2>&1
    return
  fi
  body="$summary"$'\n\n'"$count comment(s) inline."
  local payload
  payload=$(jq -c --arg sha "$sha" --arg body "$body" '{
    commit_id: $sha, event: "COMMENT", body: $body,
    comments: [.findings[] | {path, line, side: "RIGHT", body: "**[\(.severity)] \(.title)**\n\n\(.body)"}]
  }' <<<"$review")
  if ! gh api "repos/$owner/$repo/pulls/$num/reviews" --input - <<<"$payload" >>"$LOG" 2>&1; then
    # A finding outside the diff makes GitHub reject the whole review; fall back to one body comment.
    log "inline review rejected for $url, falling back to body-only review"
    payload=$(jq -c --arg sha "$sha" --arg body "$body" '{
      commit_id: $sha, event: "COMMENT",
      body: ($body + "\n\n" + ([.findings[] | "- **[\(.severity)] \(.title)** — `\(.path):\(.line)`\n  \(.body)"] | join("\n")))
    }' <<<"$review")
    gh api "repos/$owner/$repo/pulls/$num/reviews" --input - <<<"$payload" >>"$LOG" 2>&1
  fi
}

# ---------------------------------------------------------------------------------------------------
# Review flow
# ---------------------------------------------------------------------------------------------------

# run_review <requester> <url> <pr-json> <budget> <out-file> — runs the read-only reviewer on a private
# checkout; prints the review JSON. Exit 2 = checkout failed, 1 = review failed (spend still recorded).
run_review() {
  local uid=$1 url=$2 info=$3 budget=$4 out=$5 owner repo num sha base wt review
  read -r owner repo num <<<"$(pr_parts "$url")"
  sha=$(jq -r .headRefOid <<<"$info"); base=$(jq -r .baseRefName <<<"$info")
  wt=$(prepare_checkout "$owner" "$repo" "$num" "$sha" "$base") || return 2

  log "reviewing $url at ${sha:0:7} for $uid (budget \$$budget)"
  claude_call "$wt" "$(cfg review_model)" "$budget" "$SCHEMA" \
    "$(render_prompt "$PROMPT" "ME=$(cfg self_github_login)" "PR_URL=$url" "PR_NUMBER=$num" "BASE=$base" "SHA=$sha" "LEVEL=$(cfg review_level)")" \
    --allowedTools "${REVIEW_ALLOWED_TOOLS[@]}" --disallowedTools "${REVIEW_DENIED_TOOLS[@]}" > "$out"
  cleanup_checkout "$owner" "$repo" "$wt"

  review=$(jq -c '.structured_output // empty' "$out" 2>/dev/null || true)
  if [[ -z "$review" ]]; then
    record_spend review "$uid" "$url" "$sha" error "$out"
    log "review failed for $url: $(jq -r '.subtype // .result // "no output"' "$out" 2>/dev/null)"
    return 1
  fi
  printf '%s' "$review"
}

# skip_reason <url> <pr-json> — prints why the PR needs no review and exits 0, or exits 1 if it does:
#   closed:<state> | approved (by you, at head) | reviewed:<approved|commented> (by us, at head)
skip_reason() {
  local url=$1 info=$2 state sha prev
  state=$(jq -r .state <<<"$info"); sha=$(jq -r .headRefOid <<<"$info")
  if [[ "$state" != OPEN ]]; then echo "closed:$(tr '[:upper:]' '[:lower:]' <<<"$state")"; return 0; fi
  if i_approved_at "$info" "$sha"; then echo approved; return 0; fi
  prev=$(state_get '.reviews[$u] | select(.sha == $s) | .result' --arg u "$url" --arg s "$sha")
  if [[ -n "$prev" ]]; then echo "reviewed:$prev"; return 0; fi
  return 1
}

# review_budget — prints the --max-budget-usd for the next review, or exits 1 if the month is spent.
review_budget() {
  local remaining; remaining=$(remaining_budget)
  if ! float_ge "$remaining" "$MIN_REVIEW_BUDGET_USD"; then
    log "budget exhausted (\$$remaining left)"; return 1; fi
  float_min "$remaining" "$(cfg per_review_budget_usd)"
}

# publish_review <requester> <url> <sha> <review-json> <claude-out-file> — posts the GitHub review,
# records spend and the reviewed SHA. Exits 1 if GitHub rejected it (spend still recorded).
publish_review() {
  local requester=$1 url=$2 sha=$3 review=$4 out=$5 count result
  if ! post_github_review "$url" "$sha" "$review"; then
    record_spend review "$requester" "$url" "$sha" post-failed "$out"; return 1
  fi
  count=$(jq '.findings | length' <<<"$review")
  result=$([[ $count -eq 0 ]] && echo approved || echo commented)
  record_spend review "$requester" "$url" "$sha" "$result" "$out"
  state_update '.reviews[$u] = {sha: $s, result: $r, findings: ($n|tonumber), at: $t}' \
    --arg u "$url" --arg s "$sha" --arg r "$result" --arg n "$count" --arg t "$(date -u +%FT%TZ)"
}

# ---------------------------------------------------------------------------------------------------
# Review notes — written by the ainotes review-note tool (ainotes-review-notes skill)
# ---------------------------------------------------------------------------------------------------

# my_latest_review_url <url> — html_url of my most recent review on the PR (empty if none)
my_latest_review_url() {
  local owner repo num; read -r owner repo num <<<"$(pr_parts "$1")"
  gh api --paginate "repos/$owner/$repo/pulls/$num/reviews" 2>>"$LOG" \
    | jq -rs --arg me "$(cfg self_github_login)" '[add[]? | select(.user.login == $me)] | last | .html_url // empty'
}

# file_review_note <url> <pr-json> <review-json> <claude-out-file> — hand the published review to
# review-note.sh (next to this script), which writes or extends the PR's note in
# <notes_repo>/reviews/, indexes and commits it. Prints the note path.
file_review_note() {
  local url=$1 info=$2 review=$3 out=$4 tool="$SCRIPT_DIR/review-note.sh"
  [[ -x "$tool" ]] || { log "ainotes review-note tool not installed ($tool); no review note"; return 1; }
  jq -n --argjson info "$info" --argjson review "$review" --slurpfile out "$out" \
    --arg url "$url" --arg gh_review "$(my_latest_review_url "$url")" \
    --arg model "$(cfg review_model)" --arg level "$(cfg review_level)" '
    ($out[0] // {}) as $o
    | ([$info.statusCheckRollup[]? | (.conclusion // .state // "" | ascii_upcase)]) as $checks
    | {
        pr: {
          url: $url, title: $info.title, author: $info.author.login, base: $info.baseRefName,
          head_sha: $info.headRefOid, head_ref: $info.headRefName,
          additions: $info.additions, deletions: $info.deletions, changed_files: $info.changedFiles,
          ci: (if ($checks | length) == 0 then "none"
               elif any($checks[]; IN("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE")) then "failure"
               elif any($checks[]; IN("", "PENDING", "IN_PROGRESS", "QUEUED", "EXPECTED", "WAITING")) then "pending"
               else "success" end)
        },
        review: ($review + {verdict: (if (($review.findings // []) | length) == 0 then "approved" else "commented" end)}),
        meta: {
          reviewer: {model: $model, level: $level},
          cost_usd: ($o.total_cost_usd // null),
          tokens: {input: (($o.usage.input_tokens // 0) + ($o.usage.cache_read_input_tokens // 0) + ($o.usage.cache_creation_input_tokens // 0)),
                   output: ($o.usage.output_tokens // 0)},
          duration: (($o.duration_ms // 0) / 1000 | floor | "\(. / 60 | floor)m\(. % 60)s"),
          github_review_url: (if $gh_review == "" then null else $gh_review end)
        }
      }' | (cd "$WORKSPACE" && "$tool") 2>>"$LOG"
}

cmd_spend() {
  ensure_state
  local month=${1:-$(date +%Y-%m)}
  jq -s -r --arg m "$month" --arg cap "$(cfg monthly_budget_usd)" '
    [.[] | select(.month == $m)] as $r
    | "Spend for \($m): $\(([$r[].cost_usd] | add // 0) * 100 | round / 100) of $\($cap)",
      ($r | group_by(.kind)[] | "  \(.[0].kind): \(length) call(s), $\(([.[].cost_usd] | add) * 100 | round / 100)"),
      "Reviews:",
      ($r[] | select(.kind == "review") | "  \(.ts)  \(.result)  $\(.cost_usd * 100 | round / 100)  \(.tokens.input + .tokens.cache_read + .tokens.cache_creation) in / \(.tokens.output) out  \(.pr)")
  ' "$LEDGER"
}

# review <pr-url> [--dry-run] — review one PR: skip rules, budget, read-only reviewer, then post the
# approval or COMMENT review on GitHub. --dry-run posts nothing and ignores the skip rules.
# Exit codes: 0 reviewed or skipped, 1 failure, 3 monthly budget exhausted.
cmd_review() {
  local url="" dry=false arg
  for arg in "$@"; do case "$arg" in --dry-run) dry=true ;; *) url=$arg ;; esac; done
  [[ -n "$url" ]] || die "usage: review <pr-url> [--dry-run]"
  ensure_state
  acquire_lock || die "another review is running; try again shortly"
  local info sha title reason budget review owner repo num out
  info=$(pr_info "$url") || die "can't read $url"
  sha=$(jq -r .headRefOid <<<"$info"); title=$(jq -r .title <<<"$info")
  read -r owner repo num <<<"$(pr_parts "$url")"
  if ! $dry && reason=$(skip_reason "$url" "$info"); then echo "skip   $url ($reason at ${sha:0:7})"; return 0; fi
  budget=$(review_budget) || { echo "stop   monthly budget of \$$(cfg monthly_budget_usd) exhausted"; return 3; }

  out="$RUN_DIR/review-$repo-$num.json"
  review=$(run_review cli "$url" "$info" "$budget" "$out") || die "review of $url failed (see $LOG)"
  local verdict cost
  verdict=$(jq -r 'if (.findings|length)==0 then "approve" else "comment (\(.findings|length) findings)" end' <<<"$review")
  cost=$(jq -r '.total_cost_usd * 100 | round / 100' "$out")
  if $dry; then
    record_spend review-dry-run cli "$url" "$sha" "would-$verdict" "$out"
    echo "dry    $url would $verdict  \$$cost"; jq . <<<"$review"; return 0
  fi
  publish_review cli "$url" "$sha" "$review" "$out" || die "review of $url done but posting to GitHub failed (see $LOG)"
  local note; note=$(file_review_note "$url" "$info" "$review" "$out") || { log "review note for $url failed"; note=""; }
  echo "done   $url $([[ $verdict == approve ]] && echo approved || echo "${verdict/comment/commented}")  \$$cost  — $title${note:+ (note: ${note#"$WORKSPACE"/})}"
}

cmd_status() {
  ensure_state
  echo "reviewer: $(cfg review_model), /code-review $(cfg review_level), up to \$$(cfg per_review_budget_usd) per review"
  echo "this month: \$$(month_spend) of \$$(cfg monthly_budget_usd) (remaining \$$(remaining_budget))"
  echo "reviewed PRs on record: $(jq '.reviews | length' "$STATE")"
}

main() {
  local cmd=${1:-}; shift || true
  case "$cmd" in
    review) cmd_review "$@" ;;
    dry-run) cmd_review "$@" --dry-run ;;
    spend) cmd_spend "$@" ;;
    status) cmd_status ;;
    *) sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 1 ;;
  esac
}
# Run only when executed, so the functions can be sourced for testing.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
