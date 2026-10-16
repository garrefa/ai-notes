#!/usr/bin/env bash
#
# notes.sh — command line for the notes repo: CRUD for notes and plans, plus listing, reading and
# searching every other file in it (daily plans, reviews, tasks, the support KB, the ledgers).
#
# The notes repo is whatever directory the AINOTES_DIR environment variable names (the folder that
# holds `.config.yml`). Nothing is discovered from the current directory, so it works from anywhere
# and in scripts.
#
# Usage:
#   notes.sh list   [--kind KIND] [--type note|plan] [--tag TAG] [--repo REPO] [--name TEXT] [--json]
#   notes.sh search PATTERN [--kind KIND] [--tag TAG] [--repo REPO] [--regex] [--case] [--files]
#                   [--json]
#   notes.sh show   REF [--json]
#   notes.sh create --title TITLE [--type note|plan] [--slug SLUG] [--repo REPO] [--domain a,b]
#                   [--tags a,b] [--epic KEY] [--status STATUS] [--link PATH]... [--body FILE|-]
#                   [--date YYYY-MM-DD] [--jira KEY] [--worktree PATH] [--message MSG] [--no-commit]
#   notes.sh update REF [--title TITLE] [--status STATUS] [--repo REPO] [--epic KEY] [--domain a,b]
#                   [--tags a,b] [--add-tag TAG]... [--link PATH]... [--add-link PATH]...
#                   [--jira KEY] [--worktree PATH] [--body FILE|-] [--message MSG] [--no-commit]
#   notes.sh delete REF --yes [--message MSG] [--no-commit]
#   notes.sh commit --message MSG PATH...
#
#   KIND  where a file lives: the top-level folder (notes, plans, daily, reviews, tasks, support-kb,
#         ...) or `root` for files directly in the notes repo (INDEX.md, PRS.md, ...); default all.
#         `--type note|plan` matches the frontmatter `type:` instead (so it skips the html/json
#         assets kept in notes/<name>-data/ folders).
#   REF   a path relative to AINOTES_DIR (notes/2026-09-03-foo.md, INDEX.md), or a filename / slug
#         that matches exactly one file (2026-09-03-foo, or just foo).
#
# list/search/show cover every file in the notes repo except .git/, .state/ and node_modules/.
# search looks inside file contents: case-insensitive fixed text by default, --regex for an
# extended regular expression, --case to match case, --files to print matching files only.
# Rows show the file's `# title`, else its first heading, else its filename.
#
# create/update/delete only work on notes/ and plans/; the other folders and the ledgers belong to
# ax-tasks, ax-daily-plan, ax-pr-tracker and ax-review-notes. They keep the ax-notes rules:
#   - files are `<type>s/YYYY-MM-DD-slug.md` with the ax-notes frontmatter, and a `# title` line;
#   - at least one tag across --domain and --tags is required (untagged files are invisible to
#     INDEX.md); each tag gets the file appended under its `## tag` section, never a regenerated file;
#   - a plan's body is immutable: `update --body` only works on notes (plans take frontmatter edits);
#   - tag/domain/--link values REPLACE the field on update; --add-tag and --add-link append;
#   - every write is committed to the notes repo's current branch with only the files it touched
#     (never `git add -A`, never a push), message "Add|Update|Delete <type>: <slug>" unless
#     --message is given. INDEX.md is left alone (and said so on stderr) when it already has
#     uncommitted edits.
#   - several changes in one commit: run each with --no-commit, then
#     `notes.sh commit --message MSG <each touched path> INDEX.md` (commit takes only notes/*.md,
#     plans/*.md and INDEX.md).
#
# Needs git; --json output needs jq. bash 3.2-safe.

set -euo pipefail

PROG="$(basename "$0")"

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
warn() { printf '%s: %s\n' "$PROG" "$*" >&2; }

usage() { awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' "$0"; }

# ---------------------------------------------------------------------------------------------
# Notes repo location
# ---------------------------------------------------------------------------------------------

require_notes_dir() {
  [[ -n "${AINOTES_DIR:-}" ]] || die "AINOTES_DIR is not set; point it at your notes repo (the folder holding .config.yml)"
  [[ -d "$AINOTES_DIR" ]] || die "AINOTES_DIR=$AINOTES_DIR is not a directory"
  NOTES_DIR="$(cd "$AINOTES_DIR" && pwd -P)"
  [[ -d "$NOTES_DIR/.git" ]] || warn "$NOTES_DIR is not a git repo; writes will not be committed"
}

in_git_repo() { [[ -d "$NOTES_DIR/.git" ]]; }

# type_dir TYPE — the folder a type lives in
type_dir() {
  case "$1" in
    note) echo notes ;;
    plan) echo plans ;;
    *) die "unknown type '$1' (expected note or plan)" ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# Frontmatter and body helpers
# ---------------------------------------------------------------------------------------------

# frontmatter FILE — the lines between the first two `---` markers
frontmatter() { awk 'NR==1 && $0!="---" {exit} NR>1 && $0=="---" {exit} NR>1 {print}' "$1"; }

# body FILE — everything after the closing `---` (the whole file when it has no frontmatter)
body() { awk 'NR==1 && $0!="---" {c=2} c>=2 {print; next} $0=="---" {c++}' "$1"; }

# fm_get FILE KEY — the field's value as written, quotes trimmed ([a, b] stays as a flow list)
fm_get() {
  frontmatter "$1" | awk -v key="$2" '
    index($0, key ":") == 1 { v = substr($0, length(key) + 2); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
                              gsub(/^["\047]|["\047]$/, "", v); print v; exit }'
}

# fm_list FILE KEY — the field's items one per line, from either `[a, b]` or a `- a` block list
fm_list() {
  frontmatter "$1" | awk -v key="$2" '
    index($0, key ":") == 1 {
      v = substr($0, length(key) + 2); sub(/^[ \t]+/, "", v)
      if (v ~ /^\[/) { gsub(/^\[|\]$/, "", v); n = split(v, a, /,[ \t]*/)
                       for (i = 1; i <= n; i++) { gsub(/^["\047]|["\047]$/, "", a[i]); if (a[i] != "") print a[i] }
                       exit }
      inblock = 1; next }
    inblock && /^[ \t]+-[ \t]/ { v = $0; sub(/^[ \t]+-[ \t]+/, "", v); gsub(/^["\047]|["\047]$/, "", v); print v; next }
    inblock { exit }'
}

# file_row REL — a tab-separated row for the file at REL (relative to NOTES_DIR), read in one pass:
# path, date, kind, type, status, repo, title. date/type/status/repo come from frontmatter (date falls
# back to a YYYY-MM-DD filename prefix); the title is the first `# ` heading outside code fences, else
# the first heading of any level, else the filename without its date prefix and extension.
file_row() {
  local rel="$1" kind base markdown=0
  kind="$(kind_of "$rel")"
  base="$(basename "$rel")"
  # only markdown has headings; `# ...` in .yml/.gitignore is a comment, so those titles are the filename
  case "$base" in *.md) markdown=1; base="${base%.md}" ;; esac
  awk -v rel="$rel" -v kind="$kind" -v base="$base" -v markdown="$markdown" '
    function trim(v) { sub(/^[ \t]+/, "", v); sub(/[ \t\r]+$/, "", v); gsub(/^["\047]|["\047]$/, "", v); return v }
    NR == 1 && $0 == "---" { infm = 1; next }
    infm && $0 == "---" { infm = 0; next }
    infm {
      for (i = 1; i <= 4; i++) {
        key = (i == 1 ? "date" : i == 2 ? "type" : i == 3 ? "status" : "repo")
        if (index($0, key ":") == 1) fm[key] = trim(substr($0, length(key) + 2))
      }
      next
    }
    !markdown { next }
    /^(```|~~~)/ { fence = !fence; next }
    fence { next }
    /^# / && h1 == "" { h1 = $0; sub(/^# +/, "", h1); h1 = trim(h1); next }
    /^#+ / && any == "" { any = $0; sub(/^#+ +/, "", any); any = trim(any) }
    END {
      date = fm["date"]
      if (date == "" && base ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) date = substr(base, 1, 10)
      title = (h1 != "" ? h1 : any != "" ? any : base)
      if (h1 == "" && any == "") sub(/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-/, "", title)
      if (fm["status"] == "null") fm["status"] = ""
      if (fm["repo"] == "null") fm["repo"] = ""
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", rel, (date == "" ? "-" : date), kind, fm["type"], fm["status"], fm["repo"], title
    }' "$NOTES_DIR/$rel"
}

# join_flow ITEM... — `[a, b]`
join_flow() {
  local out="" item
  for item in "$@"; do out="${out:+$out, }$item"; done
  printf '[%s]' "$out"
}

# split_csv CSV — one trimmed non-empty item per line
split_csv() { printf '%s' "$1" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | awk 'NF'; }

# render_field KEY VALUE... — the frontmatter lines for a list field: `key: []`, `key: [a, b]`, and
# `links` as a block list the way existing notes write it
render_list_field() {
  local key="$1" item; shift
  if [[ "$key" == links && $# -gt 0 ]]; then
    printf 'links:\n'; for item in "$@"; do printf '  - %s\n' "$item"; done
  else
    printf '%s: %s\n' "$key" "$(join_flow "$@")"
  fi
}

# set_field FILE KEY RENDERED — replace the field (its line plus any block-list lines) with RENDERED
# (one or more complete lines), or add it before the closing `---` if the note lacks it
set_field() {
  local file="$1" key="$2" rendered="$3" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  RENDERED="$rendered" awk -v key="$key" '
    NR == 1 && $0 == "---" { print; infm = 1; next }
    infm && $0 == "---" { if (!done) print ENVIRON["RENDERED"]; infm = 0; print; next }
    infm && index($0, key ":") == 1 { if (!done) print ENVIRON["RENDERED"]; done = 1; skipping = 1; next }
    infm && skipping && /^[ \t]+-[ \t]/ { next }
    infm { skipping = 0 }
    { print }' "$file" >"$tmp"
  mv "$tmp" "$file"
}

# replace_body FILE BODYFILE — keep the frontmatter, swap everything after it
replace_body() {
  local file="$1" newbody="$2" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  { awk 'NR==1 {print; next} {print} $0=="---" {exit}' "$file"; echo; cat "$newbody"; } >"$tmp"
  mv "$tmp" "$file"
}

# set_title FILE TITLE — rewrite the `# title` line, or insert one at the top of the body
set_title() {
  local file="$1" title="$2" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  awk -v title="$title" '
    c < 2 { print; if ($0 == "---") c++; if (c == 2) print ""; next }
    !done && /^# / { print "# " title; done = 1; next }
    !done && NF { print "# " title; print ""; done = 1 }
    { print }
    END { if (!done) print "# " title }' "$file" >"$tmp"
  # the blank line printed right after the closing --- duplicates the one already there; squeeze it
  cat -s "$tmp" >"$file"
  rm -f "$tmp"
}

# read_body SPEC — SPEC is `-` for stdin or a file path; prints a temp file path holding the text
read_body() {
  local spec="$1" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  if [[ "$spec" == "-" ]]; then cat >"$tmp"; else [[ -f "$spec" ]] || die "body file not found: $spec"; cat "$spec" >"$tmp"; fi
  echo "$tmp"
}

# ---------------------------------------------------------------------------------------------
# Resolving a REF to a file
# ---------------------------------------------------------------------------------------------

# all_files — every file in the notes repo (relative paths, sorted), minus .git/, .state/, node_modules/
all_files() {
  (cd "$NOTES_DIR" && find . \( -name .git -o -name .state -o -name node_modules \) -prune -o \
    -type f ! -name .DS_Store -print | sed 's|^\./||' | sort)
}

# kind_of REL — the top-level folder a file lives in, or `root`
kind_of() { case "$1" in */*) echo "${1%%/*}" ;; *) echo root ;; esac; }

# require_editable REL — only notes/ and plans/ are written by this tool
require_editable() {
  case "$1" in
    notes/*/*|plans/*/*) die "$1 is an asset inside a note's data folder; only notes/*.md and plans/*.md are editable" ;;
    notes/*.md|plans/*.md) ;;
    *) die "$1 is read-only here: create/update/delete only handle notes/ and plans/ (other folders and the ledgers are owned by their ax-* skills)" ;;
  esac
}

# resolve_ref REF — prints the path relative to NOTES_DIR; dies if none or several match
resolve_ref() {
  local ref="${1#./}" rel base matches count
  [[ "$ref" != /* && "$ref" != *..* ]] || die "path must be inside the notes repo: $1"
  case "$ref" in
    .git|.git/*|.state|.state/*|node_modules/*) die "$ref is not a notes file" ;;
  esac
  if [[ -f "$NOTES_DIR/$ref" ]]; then
    [[ ! -L "$NOTES_DIR/$ref" ]] || die "$ref is a symlink; refusing to follow it out of the notes repo"
    echo "$ref"; return
  fi
  ref="${ref%.md}"
  matches="$(all_files | while IFS= read -r rel; do
    base="${rel##*/}"; base="${base%.*}"
    if [[ "$base" == "$ref" || "$base" == ????-??-??-"$ref" ]]; then echo "$rel"; fi
  done)"
  count="$(printf '%s' "$matches" | awk 'NF' | wc -l | tr -d ' ')"
  [[ "$count" -ge 1 ]] || die "no file matches '$ref'"
  [[ "$count" -eq 1 ]] || die "'$ref' is ambiguous; use a path:"$'\n'"$matches"
  echo "$matches"
}

# ---------------------------------------------------------------------------------------------
# INDEX.md
# ---------------------------------------------------------------------------------------------

index_file() { echo "$NOTES_DIR/INDEX.md"; }

# index_is_writable — INDEX.md exists and has no uncommitted edits that we would sweep into a commit
index_is_writable() {
  [[ -f "$(index_file)" ]] || { warn "no INDEX.md; skipping indexing"; return 1; }
  if [[ "$NO_COMMIT" != 1 ]] && in_git_repo && [[ -n "$(git -C "$NOTES_DIR" status --porcelain -- INDEX.md)" ]]; then
    warn "INDEX.md has uncommitted edits; not touching it (re-run indexing by hand)"
    return 1
  fi
}

# index_add TAG ENTRY — append ENTRY under `## TAG` (creating the section last), skipping duplicates
index_add() {
  local tag="$1" entry="$2" idx tmp
  idx="$(index_file)"; tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  awk -v tag="$tag" -v entry="- $entry" '
    { lines[NR] = $0 }
    $0 == "## " tag { start = NR }
    start && NR > start && /^## / && !stop { stop = NR }
    END {
      if (!start) { for (i = 1; i <= NR; i++) print lines[i]
                    if (NR && lines[NR] != "") print ""
                    print "## " tag; print entry; exit }
      end = stop ? stop - 1 : NR
      for (i = start; i <= end; i++) if (lines[i] == entry) dup = 1
      if (dup) { for (i = 1; i <= NR; i++) print lines[i]; exit }
      while (end > start && lines[end] == "") end--
      for (i = 1; i <= end; i++) print lines[i]
      print entry
      for (i = end + 1; i <= NR; i++) print lines[i]
    }' "$idx" >"$tmp"
  mv "$tmp" "$idx"
}

# index_remove ENTRY — drop every `- ENTRY` line, and any `## tag` section left empty by it
index_remove() {
  local entry="$1" idx tmp
  idx="$(index_file)"; tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  awk -v entry="- $entry" '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] == entry) { removed[i] = 1 }
      }
      # a section is dropped only if it lost lines and has no remaining `- ` entries
      i = 1
      while (i <= NR) {
        if (lines[i] ~ /^## / && !removed[i]) {
          j = i + 1; kept = 0; lost = 0
          while (j <= NR && lines[j] !~ /^## /) { if (removed[j]) lost = 1; else if (lines[j] ~ /^- /) kept = 1; j++ }
          if (lost && !kept) { i = j; continue }
        }
        if (!removed[i]) print lines[i]
        i++
      }
    }' "$idx" | trim_trailing_blanks >"$tmp"
  mv "$tmp" "$idx"
}

# trim_trailing_blanks — stdin to stdout without trailing blank lines
trim_trailing_blanks() { awk '/^[[:space:]]*$/ { blank++; next } { while (blank > 0) { print ""; blank-- } print }'; }

# index_tags FILE — domain and tags of a note, one per line, deduplicated
index_tags() { { fm_list "$1" domain; fm_list "$1" tags; } | awk 'NF && !seen[$0]++'; }

# ---------------------------------------------------------------------------------------------
# Git
# ---------------------------------------------------------------------------------------------

# commit_paths DEFAULT_MESSAGE PATH... — commit only these paths (relative to NOTES_DIR); --message overrides the message
commit_paths() {
  local message="${MESSAGE:-$1}"; shift
  in_git_repo || return 0
  [[ "$NO_COMMIT" == 1 ]] && return 0
  git -C "$NOTES_DIR" add -A -- "$@"
  git -C "$NOTES_DIR" commit -q -m "$message" -- "$@"
  git -C "$NOTES_DIR" rev-parse --short HEAD
}

# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------

# set_filter OPTION VALUE — record a list/search filter in F_KIND / F_TAG / F_REPO / F_NAME
F_KIND=""; F_TYPE=""; F_TAG=""; F_REPO=""; F_NAME=""
set_filter() {
  case "$1" in
    --kind) F_KIND="$2" ;;
    --type)
      case "$2" in
        note|plan) F_TYPE="$2" ;;
        all) F_TYPE="" ;;
        *) die "--type must be note, plan or all (use --kind for other folders)" ;;
      esac ;;
    --tag) F_TAG="$2" ;;
    --repo) F_REPO="$2" ;;
    --name) F_NAME="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')" ;;
  esac
}

# select_rows — the file_row of every file matching the filters, oldest first
select_rows() {
  local rel row hits
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    [[ -z "$F_KIND" || "$F_KIND" == all || "$(kind_of "$rel")" == "$F_KIND" ]] || continue
    if [[ -n "$F_NAME" ]]; then
      [[ "$(printf '%s' "$rel" | tr '[:upper:]' '[:lower:]')" == *"$F_NAME"* ]] || continue
    fi
    row="$(file_row "$rel")"
    [[ -z "$F_TYPE" || "$(printf '%s' "$row" | cut -f4)" == "$F_TYPE" ]] || continue
    [[ -z "$F_REPO" || "$(printf '%s' "$row" | cut -f6)" == "$F_REPO" ]] || continue
    if [[ -n "$F_TAG" ]]; then
      hits="$(index_tags "$NOTES_DIR/$rel" | grep -cxF -- "$F_TAG" || true)"
      [[ "$hits" -gt 0 ]] || continue
    fi
    printf '%s\n' "$row"
  done < <(all_files) | sort -t$'\t' -k2,2 -k1,1
}

# print_rows JSON — render file_row lines from stdin, as JSON or as `date  kind  title` + path
print_rows() {
  if [[ "$1" == 1 ]]; then
    command -v jq >/dev/null || die "--json needs jq on PATH"
    jq -R -s 'split("\n") | map(select(length>0) | split("\t")
      | {path: .[0], date: .[1], kind: .[2], type: .[3], status: .[4], repo: .[5], title: .[6]})'
  else
    awk -F'\t' '{printf "%-10s  %-10s  %s\n", $2, $3, $7; printf "                        %s\n", $1}'
  fi
}

cmd_list() {
  local json=0 rows
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --kind|--type|--tag|--repo|--name) set_filter "$1" "${2:?$1 needs a value}"; shift 2 ;;
      --json) json=1; shift ;;
      *) die "list: unknown option $1" ;;
    esac
  done
  rows="$(select_rows)"
  if [[ -n "$rows" ]]; then printf '%s\n' "$rows" | print_rows "$json"; elif [[ "$json" == 1 ]]; then echo '[]'; fi
}

cmd_search() {
  local pattern="" regex=0 match_case=0 files_only=0 json=0 rows rels hits files flags mode
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --kind|--type|--tag|--repo|--name) set_filter "$1" "${2:?$1 needs a value}"; shift 2 ;;
      --regex) regex=1; shift ;;
      --case) match_case=1; shift ;;
      --files) files_only=1; shift ;;
      --json) json=1; shift ;;
      -*) die "search: unknown option $1" ;;
      *) [[ -z "$pattern" ]] || die "search: one PATTERN only (quote it if it has spaces)"; pattern="$1"; shift ;;
    esac
  done
  [[ -n "$pattern" ]] || die "search: PATTERN required"
  rows="$(select_rows)"
  rels="$(printf '%s' "$rows" | cut -f1)"
  hits=""
  if [[ -n "$rels" ]]; then
    flags="-InH"; [[ $match_case == 1 ]] || flags="${flags}i"
    mode="-F"; [[ $regex == 0 ]] || mode="-E"
    # xargs batches the file list; grep exits 1 on no match and xargs turns that into 123, hence `|| true`
    hits="$(cd "$NOTES_DIR" && printf '%s\n' "$rels" | tr '\n' '\0' | xargs -0 grep "$flags" "$mode" -e "$pattern" -- || true)"
  fi
  files="$(printf '%s' "$hits" | cut -d: -f1 | awk 'NF && !seen[$0]++')"
  printf '%s match(es) in %s file(s)\n' "$(printf '%s' "$hits" | awk 'NF' | wc -l | tr -d ' ')" \
    "$(printf '%s' "$files" | awk 'NF' | wc -l | tr -d ' ')" >&2
  [[ -n "$hits" ]] || { [[ $json == 1 ]] && echo '[]'; return 0; }

  if [[ $files_only == 1 ]]; then
    printf '%s\n' "$rows" | MATCHED="$files" awk -F'\t' 'BEGIN { n = split(ENVIRON["MATCHED"], a, "\n"); for (i = 1; i <= n; i++) m[a[i]] = 1 } ($1 in m)' | print_rows "$json"
  elif [[ $json == 1 ]]; then
    command -v jq >/dev/null || die "--json needs jq on PATH"
    printf '%s\n' "$hits" | jq -R -s 'split("\n") | map(select(length>0)
      | capture("^(?<path>[^:]+):(?<line>[0-9]+):(?<text>.*)$") | .line |= tonumber)'
  else
    printf '%s\n' "$hits" | awk '{ line = $0; if (length(line) > 220) line = substr(line, 1, 217) "..."; print line }'
  fi
}

cmd_show() {
  local ref="" json=0 rel file
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json) json=1; shift ;;
      -*) die "show: unknown option $1" ;;
      *) [[ -z "$ref" ]] || die "show: one REF only"; ref="$1"; shift ;;
    esac
  done
  [[ -n "$ref" ]] || die "show: REF required"
  rel="$(resolve_ref "$ref")"; file="$NOTES_DIR/$rel"
  if [[ "$json" == 1 ]]; then
    command -v jq >/dev/null || die "--json needs jq on PATH"
    jq -n --arg path "$rel" --arg title "$(file_row "$rel" | cut -f7)" --arg frontmatter "$(frontmatter "$file")" \
      --arg body "$(body "$file")" '{path: $path, title: $title, frontmatter: $frontmatter, body: $body}'
  else
    cat "$file"
  fi
}

# slugify TITLE — lowercase, alphanumerics and single dashes
slugify() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g;s/^-//;s/-$//' | cut -c1-80 | sed 's/-$//'; }

cmd_create() {
  local type=note title="" slug="" repo="" domain="" tags="" epic="" status="" date_="" bodyspec=""
  local jira="" worktree="" links=() bodyfile="" item
  NO_COMMIT=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) type="${2:?}"; shift 2 ;;
      --title) title="${2:?}"; shift 2 ;;
      --slug) slug="${2:?}"; shift 2 ;;
      --repo) repo="${2:?}"; shift 2 ;;
      --domain) domain="${2:?}"; shift 2 ;;
      --tags) tags="${2:?}"; shift 2 ;;
      --epic) epic="${2:?}"; shift 2 ;;
      --status) status="${2:?}"; shift 2 ;;
      --date) date_="${2:?}"; shift 2 ;;
      --jira) jira="${2:?}"; shift 2 ;;
      --worktree) worktree="${2:?}"; shift 2 ;;
      --link) links+=("${2:?}"); shift 2 ;;
      --body) bodyspec="${2:?}"; shift 2 ;;
      --message) MESSAGE="${2:?}"; shift 2 ;;
      --no-commit) NO_COMMIT=1; shift ;;
      *) die "create: unknown option $1" ;;
    esac
  done
  local dir; dir="$(type_dir "$type")"
  [[ -n "$title" ]] || die "create: --title is required"
  [[ -n "$slug" ]] || slug="$(slugify "$title")"
  [[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "create: slug '$slug' must be lowercase letters, digits and single dashes"
  [[ -n "$date_" ]] || date_="$(date +%F)"
  [[ "$date_" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "create: --date must be YYYY-MM-DD"
  [[ -n "$status" ]] || { [[ "$type" == plan ]] && status=planned || status=n/a; }

  local domain_items=() tag_items=()
  while IFS= read -r item; do domain_items+=("$item"); done < <(split_csv "$domain")
  while IFS= read -r item; do tag_items+=("$item"); done < <(split_csv "$tags")
  [[ -n "$epic" ]] && tag_items+=("epic:$epic")
  [[ $(( ${#domain_items[@]} + ${#tag_items[@]} )) -gt 0 ]] || die "create: at least one --domain or --tags value is required"
  for item in "${links[@]+"${links[@]}"}"; do [[ -f "$NOTES_DIR/$item" ]] || die "create: --link target not found: $item"; done

  local rel="$dir/$date_-$slug.md" file
  file="$NOTES_DIR/$rel"
  [[ ! -e "$file" ]] || die "create: $rel already exists"
  mkdir -p "$NOTES_DIR/$dir"

  if [[ -n "$bodyspec" ]]; then bodyfile="$(read_body "$bodyspec")"; fi
  {
    printf -- '---\ndate: %s\ntype: %s\nrepo: %s\n' "$date_" "$type" "${repo:-null}"
    render_list_field domain "${domain_items[@]+"${domain_items[@]}"}"
    printf 'epic: %s\n' "${epic:-null}"
    render_list_field tags "${tag_items[@]+"${tag_items[@]}"}"
    printf 'jira: %s\nworktree: %s\nstatus: %s\n' "${jira:-null}" "${worktree:-null}" "$status"
    render_list_field links "${links[@]+"${links[@]}"}"
    printf -- '---\n\n'
    if [[ -n "$bodyfile" ]]; then
      if grep -q '^# ' "$bodyfile"; then cat "$bodyfile"; else printf '# %s\n\n' "$title"; cat "$bodyfile"; fi
    else
      printf '# %s\n' "$title"
    fi
  } >"$file"
  [[ -z "$bodyfile" ]] || rm -f "$bodyfile"

  local paths=("$rel")
  if index_is_writable; then
    while IFS= read -r item; do index_add "$item" "$rel"; done < <(index_tags "$file")
    paths+=(INDEX.md)
  fi
  local sha; sha="$(commit_paths "Add $type: $slug" "${paths[@]}")"
  printf '%s%s\n' "$rel" "${sha:+ ($sha)}"
}

cmd_update() {
  local ref="" title="" status="" repo="" epic="" domain="" tags="" bodyspec="" set_domain=0 set_tags=0
  local add_tags=() links=() add_links=() set_links=0 jira="" worktree="" item
  NO_COMMIT=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title) title="${2:?}"; shift 2 ;;
      --status) status="${2:?}"; shift 2 ;;
      --repo) repo="${2:?}"; shift 2 ;;
      --epic) epic="${2:?}"; shift 2 ;;
      --domain) domain="${2:?}"; set_domain=1; shift 2 ;;
      --tags) tags="${2:?}"; set_tags=1; shift 2 ;;
      --add-tag) add_tags+=("${2:?}"); shift 2 ;;
      --link) links+=("${2:?}"); set_links=1; shift 2 ;;
      --add-link) add_links+=("${2:?}"); shift 2 ;;
      --jira) jira="${2:?}"; shift 2 ;;
      --worktree) worktree="${2:?}"; shift 2 ;;
      --body) bodyspec="${2:?}"; shift 2 ;;
      --message) MESSAGE="${2:?}"; shift 2 ;;
      --no-commit) NO_COMMIT=1; shift ;;
      -*) die "update: unknown option $1" ;;
      *) [[ -z "$ref" ]] || die "update: one REF only"; ref="$1"; shift ;;
    esac
  done
  [[ -n "$ref" ]] || die "update: REF required"
  local rel file type slug
  rel="$(resolve_ref "$ref")"; require_editable "$rel"; file="$NOTES_DIR/$rel"
  type="$(fm_get "$file" type)"; slug="$(basename "$rel" .md)"
  if [[ -n "$bodyspec" && "$type" == plan ]]; then die "update: a plan's body is immutable; write a new note and --link it instead"; fi
  if [[ -z "$title$status$repo$epic$jira$worktree$bodyspec" && $set_domain$set_tags$set_links == 000 \
        && ${#add_tags[@]} -eq 0 && ${#add_links[@]} -eq 0 ]]; then
    die "update: nothing to change"
  fi
  for item in "${links[@]+"${links[@]}"}" "${add_links[@]+"${add_links[@]}"}"; do
    [[ -z "$item" || -f "$NOTES_DIR/$item" ]] || die "update: link target not found: $item"
  done

  local old_tags original="$file"; old_tags="$(index_tags "$file")"
  file="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"; cp "$original" "$file"
  trap 'rm -f "$file"' EXIT

  [[ -z "$status" ]] || set_field "$file" status "status: $status"
  [[ -z "$repo" ]] || set_field "$file" repo "repo: $repo"
  [[ -z "$epic" ]] || set_field "$file" epic "epic: $epic"
  [[ -z "$jira" ]] || set_field "$file" jira "jira: $jira"
  [[ -z "$worktree" ]] || set_field "$file" worktree "worktree: $worktree"

  if [[ $set_domain == 1 ]]; then
    local d=(); while IFS= read -r item; do d+=("$item"); done < <(split_csv "$domain")
    set_field "$file" domain "$(render_list_field domain "${d[@]+"${d[@]}"}")"
  fi
  if [[ $set_tags == 1 || ${#add_tags[@]} -gt 0 || -n "$epic" ]]; then
    local t=()
    if [[ $set_tags == 1 ]]; then while IFS= read -r item; do t+=("$item"); done < <(split_csv "$tags")
    else while IFS= read -r item; do t+=("$item"); done < <(fm_list "$file" tags); fi
    for item in "${add_tags[@]+"${add_tags[@]}"}"; do t+=("$item"); done
    [[ -z "$epic" ]] || t+=("epic:$epic")
    local uniq=(); while IFS= read -r item; do uniq+=("$item"); done < <(printf '%s\n' "${t[@]+"${t[@]}"}" | awk 'NF && !seen[$0]++')
    set_field "$file" tags "$(render_list_field tags "${uniq[@]+"${uniq[@]}"}")"
  fi
  if [[ $set_links == 1 || ${#add_links[@]} -gt 0 ]]; then
    local l=()
    if [[ $set_links == 1 ]]; then l=("${links[@]}")
    else while IFS= read -r item; do l+=("$item"); done < <(fm_list "$file" links); fi
    for item in "${add_links[@]+"${add_links[@]}"}"; do l+=("$item"); done
    local uniq_links=(); while IFS= read -r item; do uniq_links+=("$item"); done < <(printf '%s\n' "${l[@]+"${l[@]}"}" | awk 'NF && !seen[$0]++')
    set_field "$file" links "$(render_list_field links "${uniq_links[@]+"${uniq_links[@]}"}")"
  fi

  if [[ -n "$bodyspec" ]]; then
    local bodyfile; bodyfile="$(read_body "$bodyspec")"
    replace_body "$file" "$bodyfile"; rm -f "$bodyfile"
    [[ -n "$title" ]] || { grep -q '^# ' <(body "$file") || die "update: new body needs a '# title' line (or pass --title)"; }
  fi
  [[ -z "$title" ]] || set_title "$file" "$title"

  [[ -n "$(index_tags "$file")" ]] || die "update: that would leave $rel with no domain or tags"
  mv "$file" "$original"; trap - EXIT; file="$original"

  local paths=("$rel") new_tags
  new_tags="$(index_tags "$file")"
  if [[ "$old_tags" != "$new_tags" ]] && index_is_writable; then
    while IFS= read -r item; do
      printf '%s\n' "$new_tags" | grep -qxF -- "$item" || remove_from_section "$item" "$rel"
    done < <(printf '%s\n' "$old_tags")
    while IFS= read -r item; do index_add "$item" "$rel"; done < <(printf '%s\n' "$new_tags")
    paths+=(INDEX.md)
  fi
  local sha; sha="$(commit_paths "Update $type: $slug" "${paths[@]}")"
  printf '%s%s\n' "$rel" "${sha:+ ($sha)}"
}

# remove_from_section TAG ENTRY — drop ENTRY from just the `## TAG` section (and the section if it empties)
remove_from_section() {
  local tag="$1" entry="$2" idx tmp
  idx="$(index_file)"; tmp="$(mktemp "${TMPDIR:-/tmp}/notes.XXXXXX")"
  awk -v tag="$tag" -v entry="- $entry" '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] == "## " tag) { start = i }
        else if (start && !stop && lines[i] ~ /^## /) { stop = i }
      }
      if (!start) { for (i = 1; i <= NR; i++) print lines[i]; exit }
      end = stop ? stop - 1 : NR
      kept = 0
      for (i = start + 1; i <= end; i++) if (lines[i] ~ /^- / && lines[i] != entry) kept = 1
      for (i = 1; i <= NR; i++) {
        if (i > start && i <= end && lines[i] == entry) continue
        if (!kept && i >= start && i <= end) continue
        print lines[i]
      }
    }' "$idx" | trim_trailing_blanks >"$tmp"
  mv "$tmp" "$idx"
}

cmd_delete() {
  local ref="" yes=0
  NO_COMMIT=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes) yes=1; shift ;;
      --message) MESSAGE="${2:?}"; shift 2 ;;
      --no-commit) NO_COMMIT=1; shift ;;
      -*) die "delete: unknown option $1" ;;
      *) [[ -z "$ref" ]] || die "delete: one REF only"; ref="$1"; shift ;;
    esac
  done
  [[ -n "$ref" ]] || die "delete: REF required"
  local rel type slug
  rel="$(resolve_ref "$ref")"; require_editable "$rel"
  [[ $yes == 1 ]] || die "delete: pass --yes to delete $rel (it stays recoverable from git history)"
  type="$(fm_get "$NOTES_DIR/$rel" type)"; slug="$(basename "$rel" .md)"
  rm -f "$NOTES_DIR/$rel"
  local paths=("$rel")
  if index_is_writable; then index_remove "$rel"; paths+=(INDEX.md); fi
  local sha; sha="$(commit_paths "Delete ${type:-note}: $slug" "${paths[@]}")"
  printf 'deleted %s%s\n' "$rel" "${sha:+ ($sha)}"
}

# cmd_commit --message MSG PATH... — one commit for several --no-commit writes. Takes only the files
# this tool writes (notes/*.md, plans/*.md, INDEX.md); deleted paths are fine.
cmd_commit() {
  local paths=() path
  NO_COMMIT=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --message) MESSAGE="${2:?}"; shift 2 ;;
      -*) die "commit: unknown option $1" ;;
      *) path="${1#./}"
         [[ "$path" != /* && "$path" != *..* ]] || die "commit: path must be inside the notes repo: $1"
         [[ "$path" == INDEX.md ]] || require_editable "$path"
         paths+=("$path"); shift ;;
    esac
  done
  [[ -n "$MESSAGE" ]] || die "commit: --message is required"
  [[ ${#paths[@]} -gt 0 ]] || die "commit: at least one PATH is required"
  in_git_repo || die "commit: $NOTES_DIR is not a git repo"
  [[ -n "$(git -C "$NOTES_DIR" status --porcelain -- "${paths[@]}")" ]] || die "commit: nothing to commit in the given paths"
  printf 'committed %s\n' "$(commit_paths "" "${paths[@]}")"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 1; exit 0 ;;
  esac
  shift
  require_notes_dir
  NO_COMMIT=0; MESSAGE=""
  case "$cmd" in
    list|ls) cmd_list "$@" ;;
    search|grep|find) cmd_search "$@" ;;
    show|get|read) cmd_show "$@" ;;
    create|add|new) cmd_create "$@" ;;
    update|edit) cmd_update "$@" ;;
    delete|rm) cmd_delete "$@" ;;
    commit) cmd_commit "$@" ;;
    *) die "unknown command '$cmd' (list, search, show, create, update, delete, commit)" ;;
  esac
}

main "$@"
