#!/usr/bin/env bash
#
# pending-reviews.sh — AI-free list of open PRs in a GitHub org where your review is requested, least recently
# updated first (that's also the order --review works through them). By default it shows only PRs
# requesting you directly (not via a team) and hides PRs from dependabot[bot] and PRs that are stale
# (no update in 5+ days) or already approved (overall review decision APPROVED).
#
# Usage: pending-reviews.sh [ORG] [--include-teams] [--include-stale] [--include-approved] [--include-dependabot]
#                           [--no-drafts] [--no-bots]
#                           [--json | --review | --review-dry-run]
#   ORG                 GitHub org (default: vcs.org from <notes repo>/.config.yml)
#   --include-teams     also list PRs requested via one of your teams (in a separate table)
#   --include-stale     keep stale PRs
#   --include-approved  keep PRs whose review decision is already APPROVED
#   --include-dependabot  keep PRs opened by dependabot[bot]
#   --no-drafts         hide draft PRs
#   --no-bots           hide PRs opened by any bot (renovate, bitsobot-ii, cursor[bot], ...)
#   --json              JSON instead of tables (each PR gets "direct": true|false)
#   --review            after listing, run a headless Claude review on each listed PR via
#                       dm-pr-review.sh review (ainotes-dm-pr-review): approve on zero findings, else inline comments. PRs
#                       already reviewed at their current commit are skipped; stops when the monthly
#                       budget (dm_pr_review: in <notes repo>/.config.yml) is spent. Claude is only started if the
#                       list is non-empty, so a scheduled run with nothing pending costs $0.
#   --review-dry-run    same, but nothing is posted (cost still counts)
#
# Data comes from review-inbox.sh (gh search + batched GraphQL) plus one
# `user-review-requested:@me` search to tell direct requests from team ones. No LLM.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"
CONFIG="$(find_ainotes_config "$PWD" || find_ainotes_config "$SCRIPT_DIR" || true)"
[[ -n "$CONFIG" ]] || { echo "No ainotes config (<notes repo>/.config.yml) found above $PWD or $SCRIPT_DIR." >&2; exit 1; }

ORG="" JSON=false REVIEW=""
REVIEWER="$SCRIPT_DIR/dm-pr-review.sh"
HIDE_TEAMS=true HIDE_DEPENDABOT=true HIDE_STALE=true HIDE_APPROVED=true HIDE_DRAFTS=false HIDE_BOTS=false
for arg in "$@"; do
  case "$arg" in
    --include-teams) HIDE_TEAMS=false ;;
    --include-stale) HIDE_STALE=false ;;
    --include-dependabot) HIDE_DEPENDABOT=false ;;
    --include-approved) HIDE_APPROVED=false ;;
    --no-drafts) HIDE_DRAFTS=true ;;
    --no-bots) HIDE_BOTS=true ;;
    --json) JSON=true ;;
    --review) REVIEW=post ;;
    --review-dry-run) REVIEW=dry ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 1 ;;
    *) ORG=$arg ;;
  esac
done
if $JSON && [[ -n "$REVIEW" ]]; then echo "--json can't be combined with --review/--review-dry-run" >&2; exit 1; fi
[[ -n "$ORG" ]] || ORG=$(config_value "$CONFIG" vcs org)
[[ -n "$ORG" ]] || { echo "No GitHub org: pass one or set vcs.org in $CONFIG." >&2; exit 1; }

all=$("$SCRIPT_DIR/review-inbox.sh" --org "$ORG")
direct_urls=$(gh search prs --owner "$ORG" --state open --limit 200 --json url -- "user-review-requested:@me" | jq '[.[].url]')

prs=$(jq --argjson direct "$direct_urls" --argjson teams "$HIDE_TEAMS" \
  --argjson dependabot "$HIDE_DEPENDABOT" \
  --argjson stale "$HIDE_STALE" --argjson approved "$HIDE_APPROVED" \
  --argjson drafts "$HIDE_DRAFTS" --argjson bots "$HIDE_BOTS" '
  map(select(
      (($dependabot and .author == "dependabot[bot]") | not)
    and (($stale    and .stale) | not)
    and (($approved and .review_decision == "APPROVED") | not)
    and (($drafts   and .is_draft) | not)
    and (($bots     and .is_bot_author) | not)
  ) | .direct = (.url as $u | $direct | index($u) != null))
  | map(select(.direct or ($teams | not)))
  | sort_by(.updated_at)' <<<"$all")

if $JSON; then printf '%s\n' "$prs"; exit 0; fi

# print_table <heading> <prs-json>
print_table() {
  local heading=$1 rows=$2 count
  count=$(jq length <<<"$rows")
  printf '\n== %s (%s)\n' "$heading" "$count"
  (( count > 0 )) || { echo "   none"; return; }
  {
    printf 'UPDATED\tAGE\tPR\tAUTHOR\tSIZE\tCI\tREVIEW\tFLAGS\tTITLE\tURL\n'
    jq -r '.[] | [
        "\(.days_since_update)d ago",
        "\(.age_days)d",
        "\(.repo | split("/") | last)#\(.number)",
        .author,
        "+\(.additions)/-\(.deletions)",
        (.ci_state // "-" | ascii_downcase),
        (.review_decision // "-" | ascii_downcase | gsub("_"; " ")),
        ([if .is_draft then "draft" else empty end, if .stale then "stale" else empty end,
          if .is_bot_author then "bot" else empty end] | join(",") | if . == "" then "-" else . end),
        (if (.title | length) > 50 then .title[:47] + "..." else .title end),
        .url
      ] | @tsv' <<<"$rows"
  } | column -t -s $'\t'
}

print_table "Requested from you directly" "$(jq 'map(select(.direct))' <<<"$prs")"
$HIDE_TEAMS || print_table "Requested via your teams" "$(jq 'map(select(.direct | not))' <<<"$prs")"

hidden=()
$HIDE_TEAMS && hidden+=("$(jq --argjson d "$direct_urls" '[.[] | select(.url as $u | $d | index($u) == null)] | length' <<<"$all") team-only requests (--include-teams)")
$HIDE_DEPENDABOT && hidden+=("$(jq '[.[] | select(.author == "dependabot[bot]")] | length' <<<"$all") dependabot (--include-dependabot)")
$HIDE_STALE && hidden+=("$(jq '[.[] | select(.stale)] | length' <<<"$all") stale (--include-stale)")
$HIDE_APPROVED && hidden+=("$(jq '[.[] | select(.review_decision == "APPROVED")] | length' <<<"$all") already approved (--include-approved)")
$HIDE_DRAFTS && hidden+=("drafts")
$HIDE_BOTS && hidden+=("bot PRs")
echo
echo "$(jq length <<<"$prs") of $(jq length <<<"$all") pending in $ORG shown.${hidden[0]+ Hidden: $(IFS=';'; echo "${hidden[*]}" | sed 's/;/, /g') — a PR can match more than one.}"

# review_listed — hand each listed PR to the dm-pr-review reviewer, least recently updated first. Exit 3 from it
# means the monthly budget is spent: stop instead of failing every remaining PR.
review_listed() {
  local urls url rc reviewed=0 failed=0 args=()
  [[ "$REVIEW" == dry ]] && args=(--dry-run)
  urls=$(jq -r '.[].url' <<<"$prs")
  [[ -n "$urls" ]] || { echo; echo "Nothing to review — Claude not started."; return 0; }
  echo; echo "== Reviewing $(jq length <<<"$prs") PR(s)$([[ "$REVIEW" == dry ]] && echo " (dry run, nothing posted)")"
  local result
  while read -r url; do
    rc=0; result=$("$REVIEWER" review "$url" ${args[@]+"${args[@]}"} </dev/null) || rc=$?
    [[ -z "$result" ]] || printf '%s\n' "${result%%$'\n'*}"   # first line: done/skip/dry/stop verdict
    case $rc in
      0) reviewed=$((reviewed + 1)) ;;
      3) echo "Stopping: monthly review budget spent ($("$REVIEWER" spend | head -1))."; break ;;
      *) failed=$((failed + 1)) ;;
    esac
  done <<<"$urls"
  echo "$reviewed handled, $failed failed. $("$REVIEWER" spend | head -1)"
}
[[ -z "$REVIEW" ]] || review_listed
