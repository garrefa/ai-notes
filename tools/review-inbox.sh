#!/usr/bin/env bash
#
# review-inbox.sh — standalone, AI-free data gather for the ainotes-review-inbox skill.
#
# Finds every open PR across the configured GitHub org where the current gh
# user's review is requested, and enriches each with size/CI/review/label
# data via batched GraphQL `nodes(ids:)` lookups (a handful of calls, not one
# REST call per PR). Computes only objective facts — age, days since last
# update, a staleness flag, bot authorship — no judgment, no LLM. Prints one
# JSON array to stdout; nothing is written anywhere. The caller (the
# ainotes-review-inbox skill) hands this to a cheap LLM agent for the two
# genuinely fuzzy calls: summarizing each PR and picking a priority.
#
# Usage:
#   review-inbox.sh [--org ORG] [--limit N] [--stale-days N]
#
#   --org ORG          GitHub org to search (default: vcs.org from config)
#   --limit N          Max PRs to fetch (default 200; gh search paginates)
#   --stale-days N     Days since last update before a PR counts as stale (default 5)
#
# Configuration comes from the ainotes config, <notes repo>/.config.yml (see
# tools/ainotes-config.sh), found by walking up from the current directory.
# Needs `gh` (authenticated) and `jq` on PATH.
#
# Exit status is 0 with `[]` printed for the legitimate "nothing pending"
# case; non-zero only on a genuine failure to run.

set -euo pipefail

ORG=""
LIMIT=200
STALE_DAYS=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org)
      [[ $# -ge 2 ]] || { echo "--org needs a value" >&2; exit 1; }
      ORG="$2"; shift ;;
    --org=*) ORG="${1#--org=}" ;;
    --limit)
      [[ $# -ge 2 ]] || { echo "--limit needs a value" >&2; exit 1; }
      LIMIT="$2"; shift ;;
    --limit=*) LIMIT="${1#--limit=}" ;;
    --stale-days)
      [[ $# -ge 2 ]] || { echo "--stale-days needs a value" >&2; exit 1; }
      STALE_DAYS="$2"; shift ;;
    --stale-days=*) STALE_DAYS="${1#--stale-days=}" ;;
    -h|--help)
      sed -n '2,25p' "$0"
      exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) echo "Unexpected argument: $1" >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"

if [[ -z "$ORG" ]]; then
  CONFIG="$(find_ainotes_config "$PWD")" || CONFIG="$(find_ainotes_config "$SCRIPT_DIR")" || CONFIG=""
  if [[ -n "$CONFIG" ]]; then
    ORG="$(config_value "$CONFIG" vcs org)"
  fi
fi
[[ -n "$ORG" ]] || { echo "No GitHub org: set vcs.org in the ainotes config (<notes repo>/.config.yml) or pass --org ORG." >&2; exit 1; }

command -v gh >/dev/null 2>&1 || { echo "gh CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found on PATH" >&2; exit 1; }

if ! gh api user --jq '.login' >/dev/null 2>&1; then
  echo "review-inbox: gh is not authenticated in this environment — aborting." >&2
  exit 1
fi

# Retry a gh/gh-api call up to 3 times on transient failure (GraphQL batch
# calls hit GitHub's secondary rate limit more easily than the small per-PR
# REST calls check-prs.sh makes, so this backs off harder than that script's
# single-retry helper). Logs the actual error on final failure instead of
# swallowing it, so a real (non-transient) query error is diagnosable.
gh_retry() {
  local out attempt=1 delay=2
  while [[ $attempt -le 3 ]]; do
    if out="$("$@" 2>&1)"; then echo "$out"; return 0; fi
    [[ $attempt -lt 3 ]] && sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
  echo "review-inbox: gave up on: $* — last error:" >&2
  echo "$out" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Step 1 — search: every open PR in $ORG with review requested from @me
# ---------------------------------------------------------------------------

search_json="$(gh_retry gh search prs --owner "$ORG" --review-requested=@me --state open \
  --json id,number,title,url,repository,author,createdAt,updatedAt,isDraft,body \
  --limit "$LIMIT")" || search_json="[]"

pr_count="$(jq 'length' <<<"$search_json")"
if [[ "$pr_count" -eq 0 ]]; then
  echo "[]"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2 — batched GraphQL enrichment: size, review decision, labels, CI
# ---------------------------------------------------------------------------
# gh search prs doesn't return additions/deletions/changedFiles/reviewDecision
# /labels/CI state, and fetching those with one `gh pr view` per PR would mean
# dozens to hundreds of REST round-trips. Every PR's `id` from the search
# result IS its GraphQL node ID, so `nodes(ids: [...])` fetches all of them —
# chunked to stay well under GitHub's query complexity limits — in a handful
# of calls total.

GRAPHQL_QUERY='
query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id
      additions
      deletions
      changedFiles
      reviewDecision
      labels(first: 10) { nodes { name } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}'

# Portable id chunking — no `mapfile`/`readarray` (bash 3.2, macOS's stock
# /bin/bash, has neither).
IDS_FILE="$(mktemp)"
trap 'rm -f "$IDS_FILE"' EXIT
jq -r '.[].id' <<<"$search_json" > "$IDS_FILE"
total="$(wc -l < "$IDS_FILE" | tr -d ' ')"
CHUNK_SIZE=50
detail_json="[]"
start=1
while [[ $start -le $total ]]; do
  end=$((start + CHUNK_SIZE - 1))
  args=()
  while IFS= read -r id; do
    args+=( -F "ids[]=$id" )
  done < <(sed -n "${start},${end}p" "$IDS_FILE")
  part_json="$(gh_retry gh api graphql -f query="$GRAPHQL_QUERY" "${args[@]}" --jq '.data.nodes')" || part_json="[]"
  detail_json="$(jq -c -n --argjson a "$detail_json" --argjson b "$part_json" '$a + $b')"
  start=$((end + 1))
done

# ---------------------------------------------------------------------------
# Step 3 — merge + compute objective facts (age, staleness, bot authorship)
# ---------------------------------------------------------------------------

jq -c \
  --argjson details "$detail_json" \
  --argjson stale_days "$STALE_DAYS" \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  ($details | map({(.id): .}) | add) as $by_id
  | (($now | fromdateiso8601)) as $now_epoch
  | map(
      . as $pr
      | ($by_id[$pr.id] // {}) as $d
      | ($pr.createdAt | fromdateiso8601) as $created_epoch
      | ($pr.updatedAt | fromdateiso8601) as $updated_epoch
      | (($now_epoch - $created_epoch) / 86400 | floor) as $age_days
      | (($now_epoch - $updated_epoch) / 86400 | floor) as $days_since_update
      | {
          repo: $pr.repository.nameWithOwner,
          number: $pr.number,
          url: $pr.url,
          title: $pr.title,
          author: $pr.author.login,
          # Catches the GitHub App convention ("dependabot[bot]") AND custom
          # Bitso automation accounts ("bitsobot", "bitsobot-ii", ...) which do
          # not follow that convention — a soft signal for the summarizing
          # agent, not a hard filter, so a stray human "bot" in a login is an
          # acceptable false positive.
          is_bot_author: ($pr.author.login | test("bot"; "i")),
          is_draft: $pr.isDraft,
          body: ($pr.body // "" | gsub("\r?\n+"; " ") | .[0:500]),
          created_at: $pr.createdAt,
          updated_at: $pr.updatedAt,
          age_days: $age_days,
          days_since_update: $days_since_update,
          stale: ($days_since_update >= $stale_days),
          additions: ($d.additions // 0),
          deletions: ($d.deletions // 0),
          changed_files: ($d.changedFiles // 0),
          review_decision: ($d.reviewDecision // null),
          labels: (($d.labels.nodes // []) | map(.name)),
          ci_state: ($d.commits.nodes[0].commit.statusCheckRollup.state // null)
        }
    )
  | sort_by(.repo, .number)
' <<<"$search_json"
