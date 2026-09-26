#!/usr/bin/env bash
#
# check-prs.sh — standalone, AI-free refresh of PRS.md.
#
# Does what the ainotes-pr-tracker skill's "check prs" does, minus the
# narrative synthesis: reconciles Pending (open) against live GitHub state,
# refreshes deep-status detail on what's still open, and ALSO searches across
# all non-archived repos in the configured GitHub org for open PRs authored by
# the current gh user that aren't in the ledger yet (catches PRs opened
# outside Claude / ainotes-task, or in repos not cloned into the workspace).
#
# Output is mechanical: raw check names, review states, requested reviewers,
# and truncated comment snippets — no synthesized "why this matters" prose.
# Run it by hand, from cron, from launchd — whatever. It just needs `gh`
# (authenticated) and `jq` on PATH.
#
# Usage:
#   check-prs.sh [--dry-run] [--verbose] [--org ORG] [PRS.md path]
#
#   --dry-run   print the diff that would be written; change nothing
#   --verbose   log each step (and print the diff) to stderr/stdout
#   --org ORG   GitHub org/user to query (default: `vcs.org` from config)
#
# Configuration comes from the ainotes workspace's .ai-notes/config.yml,
# found by walking up (from the PRS.md path if given, else the current
# directory, else this script's own directory) until a directory containing
# .ai-notes/ turns up. The default PRS.md is <workspace>/<notes_repo>/db/PRS.md.
# The commit is made at the notes repo's git root (not the db/ folder).
# If the config has a `jira.project_key`, the first matching ticket key in a
# newly discovered PR's title fills its Jira column; otherwise it's "—".
#
# Exit status is 0 whether or not anything changed; check stdout / the git
# log for that. Non-zero only on a genuine failure to run.

set -euo pipefail

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

DRY_RUN=0
VERBOSE=0
PRS_FILE=""

ORG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --verbose|-v) VERBOSE=1 ;;
    --org)
      [[ $# -ge 2 ]] || { echo "--org needs a value" >&2; exit 1; }
      ORG="$2"
      shift
      ;;
    --org=*) ORG="${1#--org=}" ;;
    -h|--help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) PRS_FILE="$1" ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TODAY="$(date -u +%Y-%m-%d)"

# ---------------------------------------------------------------------------
# Workspace config (.ai-notes/config.yml) — read without needing yq
# ---------------------------------------------------------------------------

# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"

if [[ -n "$PRS_FILE" && -d "$(dirname "$PRS_FILE")" ]]; then
  WORKSPACE_ROOT="$(find_workspace_root "$(cd "$(dirname "$PRS_FILE")" && pwd)")" || WORKSPACE_ROOT=""
else
  WORKSPACE_ROOT="$(find_workspace_root "$PWD")" \
    || WORKSPACE_ROOT="$(find_workspace_root "$SCRIPT_DIR")" \
    || WORKSPACE_ROOT=""
fi
CONFIG=""
[[ -n "$WORKSPACE_ROOT" && -f "$WORKSPACE_ROOT/.ai-notes/config.yml" ]] && CONFIG="$WORKSPACE_ROOT/.ai-notes/config.yml"

JIRA_KEY=""
if [[ -n "$CONFIG" ]]; then
  [[ -z "$ORG" ]] && ORG="$(config_value "$CONFIG" vcs org)"
  JIRA_KEY="$(config_value "$CONFIG" jira project_key)"
  if [[ -z "$PRS_FILE" ]]; then
    NOTES_REPO="$(config_value "$CONFIG" notes_repo)"
    PRS_FILE="$WORKSPACE_ROOT/${NOTES_REPO:-notes}/db/PRS.md"
  fi
fi

[[ -n "$PRS_FILE" ]] || { echo "No PRS.md path given and no .ai-notes/config.yml found above $PWD — pass the PRS.md path." >&2; exit 1; }
[[ -n "$ORG" ]] || { echo "No GitHub org: set vcs.org in .ai-notes/config.yml or pass --org ORG." >&2; exit 1; }

log() { [[ $VERBOSE -eq 1 ]] && echo "[check-prs] $*" >&2 || true; }
warn() { echo "[check-prs] WARNING: $*" >&2; }

command -v gh >/dev/null 2>&1 || { echo "gh CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found on PATH" >&2; exit 1; }
[[ -f "$PRS_FILE" ]] || { echo "PRS.md not found at $PRS_FILE" >&2; exit 1; }
NOTES_DIR="$(cd "$(dirname "$PRS_FILE")" && pwd -P)"

# Fail loudly and immediately if gh isn't actually authenticated — e.g. when
# invoked by cron/launchd without the shell env that carries GH_TOKEN. This
# runs before anything touches PRS.md: better a clean abort every 10 minutes
# than a "successful" run that can't see any real PR state and quietly
# empties the ledger.
if ! gh api user --jq '.login' >/dev/null 2>&1; then
  echo "check-prs: gh is not authenticated in this environment — aborting without touching $PRS_FILE." >&2
  echo "check-prs: if this is running under cron/launchd, confirm GH_TOKEN reaches the job's environment." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PENDING_TSV="$WORK/pending.tsv"      # repo \t number \t opened \t jira \t lastchecked
MERGED_TSV="$WORK/merged.tsv"        # repo \t number \t opened \t merged \t jira
CLOSED_TSV="$WORK/closed.tsv"        # repo \t number \t opened \t closed \t jira
DETAIL_TSV="$WORK/detail.tsv"        # repo \t openfor \t number \t title \t lastcommit \t ci \t behind \t reviews \t owners \t comments
: > "$PENDING_TSV"; : > "$MERGED_TSV"; : > "$CLOSED_TSV"; : > "$DETAIL_TSV"

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

# Portable "whole calendar days between an ISO date and today", UTC, using
# just the date portion (matches how this ledger has always counted "Open
# for" / "Last commit" — day granularity, not elapsed seconds).
calendar_days_since() {
  local iso_date="${1:0:10}"
  local ts_epoch today_epoch
  if date --version >/dev/null 2>&1; then
    ts_epoch=$(date -u -d "$iso_date" +%s)
    today_epoch=$(date -u -d "$TODAY" +%s)
  else
    ts_epoch=$(date -u -j -f "%Y-%m-%d" "$iso_date" +%s)
    today_epoch=$(date -u -j -f "%Y-%m-%d" "$TODAY" +%s)
  fi
  echo $(( (today_epoch - ts_epoch) / 86400 ))
}

# Strip characters that would break a markdown table row or a TSV field.
sanitize() {
  tr -d '\t\r\n' | sed 's/|/\\|/g'
}

truncate_text() {
  local s="$1" max="${2:-70}"
  if [[ ${#s} -gt $max ]]; then
    echo "${s:0:$max}…"
  else
    echo "$s"
  fi
}

# First "<project_key>-<n>" ticket key in $1, or nothing (always nothing
# when no jira.project_key is configured).
extract_jira() {
  [[ -n "$JIRA_KEY" ]] || return 0
  grep -oE "${JIRA_KEY}-[0-9]+" <<<"$1" | head -1 || true
}

# Extract raw "|"-led rows from one "## Header" section of PRS.md, dropping
# the header/separator rows.
extract_rows() {
  local file="$1" header="$2"
  # The trailing "|| true" matters: grep exits 1 when a section is empty
  # (e.g. Pending (open) with zero rows), and under `set -e` + `pipefail`
  # that would otherwise abort the whole script right here.
  awk -v h="## $header" '
    $0==h {flag=1; next}
    /^## / && flag {exit}
    flag && /^\|/ {print}
  ' "$file" | grep -v '^| PR ' | grep -v '^|---' || true
}

# Print only the rows of the CURRENT (pre-run) "## Pending — Detail" table,
# so detail lookups can't accidentally match the same PR's row in the
# Pending (open) table above it.
old_detail_section() {
  awk '/^## /{insec = ($0 == "## Pending — Detail"); next} insec' "$PRS_FILE"
}

# Look up the "Behind main?" column from the CURRENT (pre-run) detail table
# for a given repo+number, used to carry the value over when GitHub reports
# a transient mergeable_state of "unknown".
old_behind_value() {
  local repo="$1" num="$2"
  old_detail_section | awk -F'|' -v pat="/$repo/pull/$num)" '$0 ~ pat {gsub(/^ +| +$/, "", $7); print $7; exit}'
}

# Carries a whole detail row forward verbatim when this pass can't refresh
# it (a failed gh call should never mean "delete this PR from the ledger").
# Prints 8 tab-separated fields: openfor,title,lastcommit,ci,behind,reviews,
# owners,comments — or nothing if this PR has no prior detail row at all
# (e.g. it was only just discovered).
old_detail_row() {
  local repo="$1" num="$2"
  old_detail_section | awk -F'|' -v pat="/$repo/pull/$num)" '
    $0 ~ pat {
      title=$3; gsub(/^[ \t]+|[ \t]+$/, "", title)
      openfor=$4; gsub(/^[ \t]+|[ \t]+$/, "", openfor); gsub(/d$/, "", openfor)
      lastcommit=$5; gsub(/^[ \t]+|[ \t]+$/, "", lastcommit); gsub(/d$/, "", lastcommit)
      ci=$6; gsub(/^[ \t]+|[ \t]+$/, "", ci)
      behind=$7; gsub(/^[ \t]+|[ \t]+$/, "", behind)
      reviews=$8; gsub(/^[ \t]+|[ \t]+$/, "", reviews)
      owners=$9; gsub(/^[ \t]+|[ \t]+$/, "", owners)
      comments=$10; gsub(/^[ \t]+|[ \t]+$/, "", comments)
      print openfor "\t" title "\t" lastcommit "\t" ci "\t" behind "\t" reviews "\t" owners "\t" comments
      exit
    }
  '
}

# retry a gh/gh-api call once on transient network failure
gh_retry() {
  local out
  if out="$("$@" 2>/dev/null)"; then
    echo "$out"
    return 0
  fi
  warn "transient failure on: $* — retrying once"
  sleep 2
  if out="$("$@" 2>&1)"; then
    echo "$out"
    return 0
  fi
  warn "gave up on: $*"
  return 1
}

# ---------------------------------------------------------------------------
# Step 1 — load existing Pending (open) rows
# ---------------------------------------------------------------------------

log "Reading existing Pending (open) rows from $PRS_FILE"

# Parses "| [#NUM](url) | repoLabel | col_a | col_b | col_c |" rows into
# "repo\tnum\tcol_a\tcol_b\tcol_c", deriving repo from the URL (not the
# label) so it's robust to any label drift. Written in POSIX awk (index,
# substr, split, gsub) so it works with macOS's stock /usr/bin/awk, not
# just gawk.
parse_link_rows() {
  awk -F'|' '
    {
      link=$2; gsub(/^[ \t]+|[ \t]+$/, "", link)
      c4=$4; gsub(/^[ \t]+|[ \t]+$/, "", c4)
      c5=$5; gsub(/^[ \t]+|[ \t]+$/, "", c5)
      c6=$6; gsub(/^[ \t]+|[ \t]+$/, "", c6)

      numstart = index(link, "#") + 1
      numend = index(link, "]")
      num = substr(link, numstart, numend - numstart)

      urlstart = index(link, "(") + 1
      urlend = index(link, ")")
      url = substr(link, urlstart, urlend - urlstart)

      n = split(url, parts, "/")
      repo = parts[n-2]

      print repo "\t" num "\t" c4 "\t" c5 "\t" c6
    }
  '
}

extract_rows "$PRS_FILE" "Pending (open)" | parse_link_rows | while IFS=$'\t' read -r repo num opened jira _lastchecked; do
  [[ -z "$repo" ]] && continue
  printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$jira" "$TODAY" >> "$PENDING_TSV"
done || true
# ^ that "|| true" isn't decorative: a `cmd | while read; do ...; done` pipeline's
# exit status is the while-loop's, which is 1 the moment it hits EOF with zero
# rows read (an *empty* Pending (open) table is a real, legitimate state) — and
# under `set -e` that would silently kill the whole script right here, before
# a single PR gets checked.

log "$(wc -l < "$PENDING_TSV" | tr -d ' ') pending row(s) loaded"

# ---------------------------------------------------------------------------
# Step 2 — org-wide discovery: open PRs authored by @me not already tracked
# ---------------------------------------------------------------------------

log "Searching $ORG org-wide for open PRs authored by @me (excluding archived repos)"

discovered_json="$(gh_retry gh search prs --owner "$ORG" --author @me --state open --archived=false \
  --json number,repository,title,url,createdAt --limit 200)" || discovered_json="[]"

already_tracked() {
  awk -F'\t' -v r="$1" -v n="$2" '$1==r && $2==n {found=1} END{exit !found}' "$PENDING_TSV"
}

new_count=0
while IFS=$'\t' read -r drepo dnum dtitle dcreated; do
  [[ -z "$drepo" ]] && continue
  if ! already_tracked "$drepo" "$dnum"; then
    djira="$(extract_jira "$dtitle")"
    [[ -z "$djira" ]] && djira="—"
    printf '%s\t%s\t%s\t%s\t%s\n' "$drepo" "$dnum" "${dcreated:0:10}" "$djira" "$TODAY" >> "$PENDING_TSV"
    new_count=$((new_count+1))
    log "discovered untracked PR: $drepo#$dnum — $dtitle"
  fi
done < <(jq -r '.[] | [.repository.name, (.number|tostring), .title, .createdAt] | @tsv' <<<"$discovered_json") || true

[[ $new_count -gt 0 ]] && log "$new_count previously-untracked PR(s) folded in"

# ---------------------------------------------------------------------------
# Step 3 — Part 1: reconcile merge/close state for every pending row
# ---------------------------------------------------------------------------

STILL_OPEN_TSV="$WORK/still_open.tsv"
: > "$STILL_OPEN_TSV"

while IFS=$'\t' read -r repo num opened jira _lastchecked; do
  [[ -z "$repo" ]] && continue
  if ! state_json="$(gh_retry gh pr view "$num" --repo "$ORG/$repo" \
    --json state,mergedAt,closedAt,url 2>/dev/null)"; then
    warn "$repo#$num: state check failed twice — carrying it forward as still-open rather than dropping it"
    printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$jira" "$TODAY" >> "$STILL_OPEN_TSV"
    continue
  fi
  state=$(jq -r '.state' <<<"$state_json")
  case "$state" in
    MERGED)
      mdate=$(jq -r '.mergedAt[0:10]' <<<"$state_json")
      printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$mdate" "$jira" >> "$MERGED_TSV"
      log "$repo#$num -> MERGED ($mdate)"
      ;;
    CLOSED)
      cdate=$(jq -r '.closedAt[0:10]' <<<"$state_json")
      printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$cdate" "$jira" >> "$CLOSED_TSV"
      log "$repo#$num -> CLOSED ($cdate)"
      ;;
    *)
      printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$jira" "$TODAY" >> "$STILL_OPEN_TSV"
      ;;
  esac
done < "$PENDING_TSV" || true

# ---------------------------------------------------------------------------
# Step 4 — Part 2: deep status on every still-open PR
# ---------------------------------------------------------------------------

log "$(wc -l < "$STILL_OPEN_TSV" | tr -d ' ') PR(s) still open — gathering deep status"

while IFS=$'\t' read -r repo num opened jira lastchecked; do
  [[ -z "$repo" ]] && continue
  log "deep status: $repo#$num"

  if ! view_json="$(gh_retry gh pr view "$num" --repo "$ORG/$repo" \
    --json title,statusCheckRollup,createdAt,commits 2>/dev/null)"; then
    old_row="$(old_detail_row "$repo" "$num")"
    printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$jira" "$TODAY" >> "$WORK/final_pending.tsv"
    if [[ -n "$old_row" ]]; then
      warn "$repo#$num: deep status failed twice — carrying its detail row forward unchanged"
      IFS=$'\t' read -r c_openfor c_title c_lastcommit c_ci c_behind c_reviews c_owners c_comments <<<"$old_row"
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$repo" "$c_openfor" "$num" "$c_title (jira:$jira)" "$c_lastcommit" "$c_ci" "$c_behind" "$c_reviews" "$c_owners" "$c_comments" \
        >> "$DETAIL_TSV"
    else
      warn "$repo#$num: deep status failed twice and there's no prior detail row to carry over — it stays in Pending (open) but its Detail row will be missing until a later run succeeds"
    fi
    continue
  fi
  title="$(jq -r '.title' <<<"$view_json" | sanitize)"
  created_at="$(jq -r '.createdAt' <<<"$view_json")"
  last_commit_at="$(jq -r '.commits[-1].committedDate' <<<"$view_json")"

  openfor=$(calendar_days_since "$created_at")
  lastcommit_days=$(calendar_days_since "$last_commit_at")

  api_json="$(gh_retry gh api "repos/$ORG/$repo/pulls/$num" \
    --jq '{mergeable_state, requested_reviewers: [.requested_reviewers[].login], requested_teams: [.requested_teams[].slug]}' 2>/dev/null)" \
    || api_json='{"mergeable_state":"unknown","requested_reviewers":[],"requested_teams":[]}'
  mergeable_state="$(jq -r '.mergeable_state' <<<"$api_json")"

  case "$mergeable_state" in
    behind) behind="Yes" ;;
    dirty) behind="Conflicts — dirty" ;;
    unknown)
      behind="$(old_behind_value "$repo" "$num")"
      [[ -z "$behind" ]] && behind="No"
      ;;
    *) behind="No" ;;
  esac

  owners_reviewers="$(jq -r '.requested_reviewers | join(", ")' <<<"$api_json")"
  owners_teams="$(jq -r '.requested_teams | map("team:" + .) | join(", ")' <<<"$api_json")"
  owners=""
  [[ -n "$owners_reviewers" ]] && owners="$owners_reviewers"
  if [[ -n "$owners_teams" ]]; then
    [[ -n "$owners" ]] && owners="$owners, $owners_teams" || owners="$owners_teams"
  fi
  [[ -z "$owners" ]] && owners="None"

  reviews_json="$(gh_retry gh api "repos/$ORG/$repo/pulls/$num/reviews" \
    --jq '[.[] | {user: .user.login, state}] | unique' 2>/dev/null)" || reviews_json="[]"
  reviews="$(jq -r 'map(.user + " (" + .state + ")") | join(", ")' <<<"$reviews_json")"
  [[ -z "$reviews" ]] && reviews="None"

  ci_json="$(jq -c '
    [ .statusCheckRollup[]?
      | select(
          (.__typename=="CheckRun" and ((.conclusion // "") as $c | ($c=="" or ($c!="SUCCESS" and $c!="SKIPPED" and $c!="NEUTRAL"))))
          or
          (.__typename=="StatusContext" and .state != "SUCCESS")
        )
      | if .__typename=="CheckRun"
          then {name: .name, result: (if .conclusion=="" then "IN_PROGRESS" else .conclusion end)}
          else {name: .context, result: .state}
        end
    ] | unique_by(.name + .result)
  ' <<<"$view_json")"
  ci_count=$(jq 'length' <<<"$ci_json")
  if [[ "$ci_count" -eq 0 ]]; then
    ci="🟢 Green"
  else
    ci_list="$(jq -r 'map(.name + " (" + .result + ")") | join(", ")' <<<"$ci_json")"
    ci="🔴 Failing — $(truncate_text "$ci_list" 160)"
  fi

  # shellcheck disable=SC2016  # $owner/$repo/$num are GraphQL variables, not shell
  thread_json="$(gh_retry gh api graphql -f query='
    query($owner:String!, $repo:String!, $num:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$num) {
          reviewThreads(first:50) {
            nodes { isResolved comments(first:1) { nodes { author { login } body } } }
          }
        }
      }
    }' -f owner="$ORG" -f repo="$repo" -F num="$num" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | {author: .comments.nodes[0].author.login, body: .comments.nodes[0].body}]' \
    2>/dev/null)" || thread_json="[]"
  thread_count=$(jq 'length' <<<"$thread_json")
  if [[ "$thread_count" -eq 0 ]]; then
    comments="None"
  else
    snippets="$(jq -r '.[0:2][] | .author + ": " + (.body | gsub("\r?\n"; " "))' <<<"$thread_json" \
      | while IFS= read -r s; do truncate_text "$(sanitize <<<"$s")" 70; done | paste -sd';' - | sed 's/;/; /g')"
    comments="$thread_count unresolved: $snippets"
    [[ $thread_count -gt 2 ]] && comments="$comments (+$((thread_count-2)) more)"
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$repo" "$openfor" "$num" "$title (jira:$jira)" "$lastcommit_days" "$ci" "$behind" "$reviews" "$owners" "$comments" \
    >> "$DETAIL_TSV"

  printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$num" "$opened" "$jira" "$TODAY" >> "$WORK/final_pending.tsv"
done < "$STILL_OPEN_TSV" || true

touch "$WORK/final_pending.tsv"

# Defense in depth: every row that started this run in PENDING_TSV must end
# up in exactly one of {still open, merged, closed} by now. If the counts
# don't add up, something ate a PR — abort loudly rather than write a
# ledger with rows silently missing. (This is what should have caught the
# incident that first prompted this check: a systemic gh auth failure that
# quietly dropped every pending PR instead of erroring.)
before_count=$(wc -l < "$PENDING_TSV" | tr -d ' ')
after_count=$(( $(wc -l < "$WORK/final_pending.tsv" | tr -d ' ') + $(wc -l < "$MERGED_TSV" | tr -d ' ') + $(wc -l < "$CLOSED_TSV" | tr -d ' ') ))
if [[ "$before_count" -ne "$after_count" ]]; then
  echo "check-prs: SANITY CHECK FAILED — started with $before_count tracked PR(s) but only" >&2
  echo "check-prs: $after_count are accounted for across still-open/merged/closed. Aborting" >&2
  echo "check-prs: WITHOUT writing $PRS_FILE — this should never happen; treat it as a bug." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 5 — render PRS.md
# ---------------------------------------------------------------------------

render_pending_table() {
  echo '| PR | Repo | Opened | Jira | Last checked (UTC) |'
  echo '|---|---|---|---|---|'
  while IFS=$'\t' read -r repo num opened jira lastchecked; do
    [[ -z "$repo" ]] && continue
    echo "| [#$num](https://github.com/$ORG/$repo/pull/$num) | $repo | $opened | $jira | $lastchecked |"
  done < "$WORK/final_pending.tsv" || true
}

render_merged_table() {
  echo '| PR | Repo | Opened | Merged | Jira |'
  echo '|---|---|---|---|---|'
  cat <(extract_rows "$PRS_FILE" "Merged")
  while IFS=$'\t' read -r repo num opened mdate jira; do
    [[ -z "$repo" ]] && continue
    echo "| [#$num](https://github.com/$ORG/$repo/pull/$num) | $repo | $opened | $mdate | $jira |"
  done < "$MERGED_TSV" || true
}

render_closed_table() {
  echo '| PR | Repo | Opened | Closed | Jira |'
  echo '|---|---|---|---|---|'
  cat <(extract_rows "$PRS_FILE" "Closed (not merged)")
  while IFS=$'\t' read -r repo num opened cdate jira; do
    [[ -z "$repo" ]] && continue
    echo "| [#$num](https://github.com/$ORG/$repo/pull/$num) | $repo | $opened | $cdate | $jira |"
  done < "$CLOSED_TSV" || true
}

render_detail_table() {
  echo "_Last deep check: $TODAY (automated, no AI — see tools/check-prs.sh). Regenerated"
  echo "wholesale each run — not an accumulating log._"
  echo
  echo '| PR | Title | Open for | Last commit | CI | Behind main? | Reviews | Pending code owners | Unresolved comments |'
  echo '|---|---|---|---|---|---|---|---|---|'
  sort -t $'\t' -k1,1 -k2,2nr -k3,3n "$DETAIL_TSV" | while IFS=$'\t' read -r repo openfor num titlejira lastcommit ci behind reviews owners comments; do
    [[ -z "$repo" ]] && continue
    title="${titlejira%% (jira:*}"
    jira="${titlejira##*(jira:}"; jira="${jira%)}"
    if [[ -n "$jira" && "$jira" != "—" && "$title" != *"$jira"* ]]; then
      pr_link="[#$num](https://github.com/$ORG/$repo/pull/$num) ($jira)"
    else
      pr_link="[#$num](https://github.com/$ORG/$repo/pull/$num)"
    fi
    echo "| $pr_link | $title | ${openfor}d | ${lastcommit}d | $ci | $behind | $reviews | $owners | $comments |"
  done || true
}

NEW_FILE="$WORK/PRS.new.md"
{
  # Everything through the "## Pending (open)" heading itself is copied
  # verbatim; the table under it is fully regenerated.
  awk '/^## Pending \(open\)/{print; exit} {print}' "$PRS_FILE"
  echo
  render_pending_table
  echo
  echo '## Merged'
  echo
  render_merged_table
  echo
  echo '## Closed (not merged)'
  echo
  render_closed_table
  echo
  echo '## Pending — Detail'
  echo
  render_detail_table
} > "$NEW_FILE"

# ---------------------------------------------------------------------------
# Step 6 — diff + commit (skip entirely if it's a true no-op)
# ---------------------------------------------------------------------------

if diff -q "$PRS_FILE" "$NEW_FILE" >/dev/null 2>&1; then
  echo "check-prs: no changes."
  exit 0
fi

echo "check-prs: changes detected."
if [[ $VERBOSE -eq 1 || $DRY_RUN -eq 1 ]]; then
  diff -u "$PRS_FILE" "$NEW_FILE" || true
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "check-prs: --dry-run, not writing or committing."
  exit 0
fi

cp "$NEW_FILE" "$PRS_FILE"

# Run git at the notes repo root (PRS.md normally sits in its db/ folder), with
# the ledger addressed by its path relative to that root.
NOTES_GIT_ROOT="$(git -C "$NOTES_DIR" rev-parse --show-toplevel)" \
  || { echo "check-prs: $NOTES_DIR is not inside a git repo — not committing." >&2; exit 1; }
PRS_REL="${NOTES_DIR#"$NOTES_GIT_ROOT"}/$(basename "$PRS_FILE")"
PRS_REL="${PRS_REL#/}"

if git -C "$NOTES_GIT_ROOT" diff --quiet -- "$PRS_REL"; then
  echo "check-prs: file rewritten but git sees no diff (unexpected) — nothing to commit."
  exit 0
fi

git -C "$NOTES_GIT_ROOT" add -- "$PRS_REL"

commit_msg="check-prs (automated): refresh PR tracker"$'\n'
[[ $new_count -gt 0 ]] && commit_msg+=$'\n'"- folded in $new_count previously-untracked PR(s) discovered org-wide"
[[ -s "$MERGED_TSV" ]] && commit_msg+=$'\n'"- $(wc -l < "$MERGED_TSV" | tr -d ' ') PR(s) moved to Merged"
[[ -s "$CLOSED_TSV" ]] && commit_msg+=$'\n'"- $(wc -l < "$CLOSED_TSV" | tr -d ' ') PR(s) moved to Closed"
commit_msg+=$'\n\n'"Generated mechanically by tools/check-prs.sh — no AI involved."

git -C "$NOTES_GIT_ROOT" commit -m "$commit_msg" >/dev/null
echo "check-prs: committed $(git -C "$NOTES_GIT_ROOT" rev-parse --short HEAD)."
