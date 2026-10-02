#!/usr/bin/env bash
#
# review-note.sh — standalone, AI-free writer for PR review notes (the ainotes-review-notes skill).
#
# Takes one finished PR review as JSON and records it in the notes repo as
# <notes repo>/reviews/<first-review-date>-<repo>-<number>.md — one note per PR. The first review
# creates the note; every later review of the same PR (e.g. a re-review after new commits) appends
# a dated section and a row to the note's review history, and the frontmatter is refreshed to the
# latest review. A new note is indexed in INDEX.md under `pr-review`, the repo, its domains (from
# `domain_taxonomy`) and any Jira-style keys found in the PR title/branch. Only the note (and
# INDEX.md, when it was touched) is committed, straight to the notes repo's current branch — never
# `git add -A`, never a push. Whoever produced the review (a person in a Claude session, a headless
# reviewer script, ...) is irrelevant here: this only formats and files it.
#
# Usage:
#   review-note.sh [--input FILE|-] [--dry-run] [--no-commit]
#
#   --input FILE  review JSON (default: stdin). Shape — only pr.url, pr.title and review.verdict
#                 are required; everything else renders as "—"/"None" when missing:
#     {
#       "pr": {"url": "https://github.com/<owner>/<repo>/pull/<n>", "title": "...", "author": "...",
#              "base": "main", "head_sha": "<sha>", "head_ref": "<branch>", "additions": 2,
#              "deletions": 1, "changed_files": 1, "ci": "success|failure|pending|none"},
#       "review": {"verdict": "approved|commented|changes_requested", "summary": "...",
#                  "key_changes": ["..."], "risk": {"level": "low|medium|high", "reason": "..."},
#                  "follow_ups": ["private to-dos for the reviewer, not posted anywhere"],
#                  "findings": [{"path": "a.kt", "line": 3, "severity": "blocker|major|minor|nit",
#                                "title": "...", "body": "..."}]},
#       "meta": {"reviewer": {"model": "opus", "level": "high"}, "cost_usd": 0.96,
#                "tokens": {"input": 128400, "output": 6100}, "duration": "3m35s",
#                "github_review_url": "https://github.com/.../pull/84#pullrequestreview-1"}
#     }
#   --dry-run     print the note that would be written (and the INDEX.md tags); change nothing
#   --no-commit   write and index the note but leave committing to the caller
#
# Configuration comes from the ainotes config, `.config.yml` inside the notes repo, found by walking
# up from the current directory (else this script's own directory; see ainotes-config.sh). The
# folder holding it is the notes repo; its `domain_taxonomy` tags the note's domains.
# If INDEX.md already has uncommitted edits, indexing is skipped (and said so on stderr) rather
# than sweeping someone else's edits into this commit. Needs `jq` and `git` on PATH (bash 3.2-safe).
#
# Prints the note's path on success. Non-zero only on a genuine failure (bad input, no notes repo,
# write or commit failure).

set -euo pipefail
export LC_ALL=C

INPUT="-"
DRY_RUN=0
COMMIT=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      [[ $# -ge 2 ]] || { echo "--input needs a value" >&2; exit 1; }
      INPUT="$2"; shift ;;
    --input=*) INPUT="${1#--input=}" ;;
    --dry-run) DRY_RUN=1 ;;
    --no-commit) COMMIT=0 ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) echo "Unexpected argument: $1" >&2; exit 1 ;;
  esac
  shift
done

command -v jq >/dev/null 2>&1 || { echo "review-note.sh needs jq on PATH" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"

CONFIG="$(find_ainotes_config "$PWD" || find_ainotes_config "$SCRIPT_DIR" || true)"
[[ -n "$CONFIG" ]] || { echo "No ainotes config (<notes repo>/.config.yml) found above $PWD or $SCRIPT_DIR." >&2; exit 1; }
NOTES_DIR="$(notes_dir_of "$CONFIG")"
[[ -n "$NOTES_DIR" && -d "$NOTES_DIR" ]] || { echo "Notes repo not found for $CONFIG: ${NOTES_DIR:-unset}" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

if [[ "$INPUT" == "-" ]]; then RAW="$(cat)"; else RAW="$(cat "$INPUT")"; fi
jq -e '(.pr.url | type) == "string" and (.pr.title | type) == "string" and (.review.verdict | type) == "string"' \
  <<<"$RAW" >/dev/null 2>&1 \
  || { echo "Input must be JSON with at least pr.url, pr.title and review.verdict (see --help)." >&2; exit 1; }

PR_URL="$(jq -r .pr.url <<<"$RAW")"
[[ "$PR_URL" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]] \
  || { echo "pr.url must look like https://github.com/<owner>/<repo>/pull/<n>: $PR_URL" >&2; exit 1; }
REPO="${BASH_REMATCH[2]}"
NUMBER="${BASH_REMATCH[3]}"
TODAY="$(date +%F)"

# domains_for_repo REPO — domain_taxonomy keys whose repo list contains REPO, one per line. Handles
# both `domain: [a, b]` and block lists (`domain:` then `  - a`).
domains_for_repo() {
  awk -v repo="$1" '
    { sub(/(^|[ \t])#.*$/, "") }
    /^[^ \t]/ { inblock = ($0 ~ /^domain_taxonomy:/); next }
    !inblock { next }
    /^[ \t]+[^ \t-][^:]*:/ {
      dom = $0; sub(/^[ \t]+/, "", dom); sub(/:.*/, "", dom)
      rest = $0; sub(/^[^:]*:[ \t]*/, "", rest)
      if (rest ~ /^\[/) { gsub(/[][ \t"\047]/, "", rest); n = split(rest, a, ","); for (i = 1; i <= n; i++) if (a[i] == repo) print dom }
      next
    }
    /^[ \t]+-[ \t]*/ { item = $0; sub(/^[ \t]+-[ \t]*/, "", item); gsub(/[ \t"\047]/, "", item); if (item == repo) print dom }
  ' "$CONFIG" | awk '!seen[$0]++'
}
DOMAINS_JSON="$(domains_for_repo "$REPO" | jq -R . | jq -sc .)"

# ---------------------------------------------------------------------------
# Rendering (all in jq; every template reads only from $ctx)
# ---------------------------------------------------------------------------

CTX="$(jq -c --arg repo "$REPO" --argjson number "$NUMBER" --arg date "$TODAY" --argjson domains "$DOMAINS_JSON" '
  (.review.findings // []) as $f
  | {
      url: .pr.url, repo: $repo, pr: $number, date: $date, title: .pr.title,
      author: (.pr.author // null), base: (.pr.base // null),
      sha7: ((.pr.head_sha // "") | .[:7] | if . == "" then null else . end),
      files: (.pr.changed_files // null), additions: (.pr.additions // null), deletions: (.pr.deletions // null),
      ci: (.pr.ci // null),
      verdict: .review.verdict, summary: (.review.summary // ""),
      key_changes: (.review.key_changes // []), follow_ups: (.review.follow_ups // []),
      risk: {level: (.review.risk.level // "unrated"), reason: (.review.risk.reason // "not provided")},
      findings: $f,
      counts: (reduce ("blocker", "major", "minor", "nit") as $s ({}; .[$s] = ([$f[] | select(.severity == $s)] | length))),
      jira: ([((.pr.title // "") + " " + (.pr.head_ref // "")) | scan("\\b[A-Z][A-Z0-9]+-[0-9]+\\b")] | unique),
      domains: $domains,
      reviewer: (.meta.reviewer // null),
      cost_usd: (.meta.cost_usd // null | if . == null then null else (. * 100 | round / 100) end),
      tokens: (.meta.tokens // null), duration: (.meta.duration // null),
      github_review: (.meta.github_review_url // null)
    }' <<<"$RAW")"

JQ_DEFS='
  def dash: if . == null or . == "" then "—" else tostring end;
  def money: if . == null then "—" else "$\(.)" end;
  def sev_icon: {blocker: "🔴", major: "🟠", minor: "🟡", nit: "⚪"}[.] // "⚪";
  def risk_icon: {low: "🟢", medium: "🟡", high: "🔴"}[.] // "⚪";
  def verdict_text:
    if .verdict == "approved" then "✅ approved"
    elif .verdict == "changes_requested" then "❌ changes requested"
    else "💬 \(.verdict | gsub("_"; " "))" end
    + ([.counts | to_entries[] | select(.value > 0) | "\(.value) \(.key)"] as $c
       | if ($c | length) > 0 then " (\($c | join(", ")))" else "" end);
  def history_row:
    "| \(.date) | `\(.sha7 | dash)` | \(.verdict) | \(.findings | length) | \(.risk.level) | \(.cost_usd | money) |";
  # YAML scalars: bare when unambiguous (matches the hand-written notes), JSON-quoted otherwise.
  def yscalar:
    if type == "string" then
      (if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") then .
       elif test("^[A-Za-z][A-Za-z0-9._/@+-]*$") and (test("^(true|false|yes|no|on|off|null)$"; "i") | not) then .
       else tojson end)
    elif . == null then "null" else tostring end;
  def yvalue($indent):
    if type == "array" then "[" + (map(yscalar) | join(", ")) + "]"
    elif type == "object" then
      if length == 0 then "{}" else
      "\n" + ([to_entries[] | (.value | yvalue($indent + "  ")) as $v
               | if ($v | startswith("\n")) then "\($indent)  \(.key):\($v)" else "\($indent)  \(.key): \($v)" end] | join("\n")) end
    else yscalar end;
  def yaml: [to_entries[] | (.value | yvalue("")) as $v | if ($v | startswith("\n")) then "\(.key):\($v)" else "\(.key): \($v)" end] | join("\n");
'

# render_frontmatter FIRST_DATE REVIEW_COUNT TOTAL_COST
render_frontmatter() {
  jq -r --arg first "$1" --argjson reviews "$2" --argjson total "$3" "$JQ_DEFS"'{
    date: $first, last_reviewed: .date, type: "review", repo, domain: .domains,
    tags: (["pr-review"] + .jira), pr, url, title, author, base, head_sha: .sha7,
    verdict, findings: .counts, risk: .risk.level, jira, reviewer,
    cost_usd, total_cost_usd: $total, reviews: $reviews, tokens, duration, github_review,
    status: "n/a", links: []
  } | yaml' <<<"$CTX"
}

render_header() {
  jq -r "$JQ_DEFS"' [
    "# Review: \(.repo)#\(.pr) · \(.title)", "",
    "## Review history", "| Date | Commit | Verdict | Findings | Risk | Cost |", "|---|---|---|---|---|---|",
    history_row, "<!-- review-history:end -->"] | join("\n")' <<<"$CTX"
}

render_section() {
  jq -r "$JQ_DEFS"' [
    "## Review · \(.date) · `\(.sha7 | dash)`", "",
    "> **Verdict: \(verdict_text)** · `\(.sha7 | dash)` → `\(.base | dash)` · by @\(.author | dash) · \(.cost_usd | money) · \(.duration | dash) · risk: \(.risk.level | risk_icon) \(.risk.level)",
    "", "### Summary", (.summary | if . == "" then "Not provided." else . end),
    "", "### Key changes", (if (.key_changes | length) == 0 then "Not provided." else (.key_changes[] | "- \(.)") end),
    "", "### Risk", "**\(.risk.level | risk_icon) \(.risk.level)**: \(.risk.reason)",
    "", "### Change at a glance", "| Files | + / − | CI at review |", "|---|---|---|",
    "| \(.files | dash) | +\(.additions | dash) / −\(.deletions | dash) | \(.ci | dash) |",
    "", "### Findings",
    (if (.findings | length) == 0 then "None."
     else ("| # | Severity | Where | Finding |", "|---|---|---|---|",
           (.findings | to_entries[] | "| \(.key + 1) | \(.value.severity | sev_icon) \(.value.severity) | `\(.value.path):\(.value.line)` | \(.value.title | gsub("\\|"; "\\|")) |"))
     end),
    "", "### Follow-ups for me",
    (if (.follow_ups | length) == 0 then "None." else (.follow_ups[] | "- [ ] \(.)") end),
    (if (.findings | length) == 0 then empty else
      ("", "<details><summary>Full comments as posted</summary>", "",
       (.findings | to_entries[] | "#### \(.key + 1). \(.value.title)", "`\(.value.path):\(.value.line)` · \(.value.severity)", "", .value.body, ""),
       "</details>") end),
    "", (if .github_review == null then "GitHub review: (link unavailable)" else "[GitHub review](\(.github_review))" end)
  ] | join("\n")' <<<"$CTX"
}

# ---------------------------------------------------------------------------
# Assemble: new note, or extend the PR's existing note
# ---------------------------------------------------------------------------

mkdir -p "$NOTES_DIR/reviews" 2>/dev/null || true
EXISTING="$(ls "$NOTES_DIR"/reviews/*-"$REPO"-"$NUMBER".md 2>/dev/null | head -1 || true)"
COST="$(jq '.cost_usd // 0' <<<"$CTX")"

# fm_field FILE KEY — a top-level scalar from a note's frontmatter
fm_field() { awk -v k="$2" 'NR == 1 && $0 == "---" {on=1; next} on && $0 == "---" {exit} on && index($0, k ": ") == 1 {sub(/^[^:]*: */, ""); print; exit}' "$1"; }

if [[ -z "$EXISTING" ]]; then
  FILE="$NOTES_DIR/reviews/$TODAY-$REPO-$NUMBER.md"
  FIRST="$TODAY"; COUNT=1; TOTAL="$COST"
  BODY="$(render_header)"
else
  FILE="$EXISTING"
  FIRST="$(fm_field "$FILE" date)"; FIRST="${FIRST:-$TODAY}"
  COUNT=$(( $(fm_field "$FILE" reviews | grep -E '^[0-9]+$' || echo 1) + 1 ))
  TOTAL="$(jq -n --argjson a "$(fm_field "$FILE" total_cost_usd | grep -E '^[0-9.]+$' || echo 0)" --argjson b "$COST" '($a + $b) * 100 | round / 100')"
  ROW="$(jq -r "$JQ_DEFS"' history_row' <<<"$CTX")"
  BODY="$(awk 'f >= 2 {print} /^---$/ && f < 2 {f++}' "$FILE" \
    | awk -v row="$ROW" '/^<!-- review-history:end -->$/ {print row} {print}' | awk 'NF {f=1} f')"
fi
REL="reviews/$(basename "$FILE")"
TAGS="$(jq -r '["pr-review", .repo] + .domains + .jira | unique[]' <<<"$CTX")"

NOTE="$(printf -- '---\n%s\n---\n\n%s\n\n%s\n' "$(render_frontmatter "$FIRST" "$COUNT" "$TOTAL")" "$BODY" "$(render_section)")"

if [[ $DRY_RUN -eq 1 ]]; then
  printf '%s\n' "$NOTE"
  echo "--- would write $REL$([[ $COUNT -eq 1 ]] && printf ' and index it under: %s' "$(echo $TAGS)")" >&2
  exit 0
fi

printf '%s\n' "$NOTE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE" || { rm -f "$FILE.tmp"; echo "Could not write $FILE" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Index (new notes only) and commit
# ---------------------------------------------------------------------------

INDEX="$NOTES_DIR/INDEX.md"
PATHS=("$REL")
if [[ $COUNT -eq 1 && -f "$INDEX" ]]; then
  if git -C "$NOTES_DIR" diff --quiet -- INDEX.md 2>/dev/null; then
    while read -r tag; do
      [[ -n "$tag" ]] || continue
      entry="- $REL"
      awk -v h="## $tag" -v e="$entry" '$0 == h {on=1; next} /^## / {on=0} on && $0 == e {found=1} END {exit !found}' "$INDEX" && continue
      if grep -qxF "## $tag" "$INDEX"; then
        awk -v h="## $tag" -v e="$entry" '{print} $0 == h {print e}' "$INDEX" > "$INDEX.tmp" && mv "$INDEX.tmp" "$INDEX"
      else
        printf '\n## %s\n%s\n' "$tag" "$entry" >> "$INDEX"
      fi
    done <<<"$TAGS"
    PATHS+=("INDEX.md")
  else
    echo "INDEX.md has uncommitted edits; not indexing $REL (add it by hand)." >&2
  fi
fi

if [[ $COMMIT -eq 1 ]]; then
  git -C "$NOTES_DIR" rev-parse --show-toplevel >/dev/null 2>&1 \
    || { echo "$NOTES_DIR is not a git repo; wrote $REL but not committing." >&2; echo "$FILE"; exit 1; }
  verdict="$(jq -r .verdict <<<"$CTX")"; sha7="$(jq -r '.sha7 // "?"' <<<"$CTX")"
  git -C "$NOTES_DIR" add -- "${PATHS[@]}"
  git -C "$NOTES_DIR" commit -q -m "Add review note: $REPO#$NUMBER ($verdict, $sha7)" -- "${PATHS[@]}" \
    || { echo "Commit of $REL failed (left uncommitted)." >&2; echo "$FILE"; exit 1; }
fi
echo "$FILE"
