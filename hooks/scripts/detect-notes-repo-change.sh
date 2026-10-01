#!/bin/sh
# SessionStart hook: notice when `notes_repo` in the workspace's .ai-notes/config.yml has changed
# since the last session (renamed or moved notes repo), and have Claude alert the user to update any
# scheduled job that still points at the old folder: launchd agents in ~/Library/LaunchAgents and
# the user's crontab. A job that hardcodes the notes repo's path (e.g. check-prs.sh given an explicit
# PRS.md, or a WorkingDirectory inside it) silently stops working after a rename.
#
# The last value seen is kept in .ai-notes/.last-notes-repo. The first run only records it. After a
# change, the new value is recorded once no scheduled job references the old folder any more, so the
# alert repeats every session until the jobs are fixed, then stops.
#
# Does nothing if no .ai-notes/config.yml is found. The session directory is the hook input's `cwd`,
# falling back to $CLAUDE_PROJECT_DIR, then $PWD. Needs jq or python3 only to read that field.

read_input_field() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$1" 'getpath($k | split(".")) // empty | strings' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
try:
    v = json.load(sys.stdin)
    for k in sys.argv[1].split("."): v = v.get(k) if isinstance(v, dict) else None
except Exception: v = None
print(v if isinstance(v, str) else "")' "$1" 2>/dev/null
  else
    cat >/dev/null
  fi
}

# Walk up from $1 looking for .ai-notes/config.yml; print the workspace root, or fail.
find_workspace_root() {
  dir="$1"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -f "$dir/.ai-notes/config.yml" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# Print a top-level scalar key ($2) from a simple YAML file ($1) without needing yq.
read_config_scalar() {
  sed -n "s/^$2:[[:space:]]*//p" "$1" | head -n 1 \
    | sed -e 's/[[:space:]]#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/" \
    | grep -vxE 'null|~' || true
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Scheduled jobs that still mention $1 (the old notes repo's absolute path) as a whole path segment:
# "<path>/…", "<path>" closing a plist <string>, or "<path>" ending a crontab word. One per line.
stale_jobs() {
  old="$1"
  for plist in "$HOME"/Library/LaunchAgents/*.plist; do
    [ -f "$plist" ] || continue
    if grep -qF -e "$old/" -e "$old<" "$plist" 2>/dev/null; then
      printf 'launchd: %s\n' "$plist"
    fi
  done
  if command -v crontab >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -F -e "$old/" -e "$old " -e "$old\"" \
      | sed 's/^/crontab: /'
    crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -E "$(printf '%s' "$old" | sed 's/[][\.*^$/]/\\&/g')\$" \
      | sed 's/^/crontab: /'
  fi
}

cwd="$(read_input_field cwd)"
cwd="${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"

root="$(find_workspace_root "$cwd")" || exit 0
config="$root/.ai-notes/config.yml"
state="$root/.ai-notes/.last-notes-repo"
current="$(read_config_scalar "$config" notes_repo)"
[ -n "$current" ] || exit 0

if [ ! -f "$state" ]; then
  printf '%s\n' "$current" > "$state" 2>/dev/null
  exit 0
fi

previous="$(head -n 1 "$state" 2>/dev/null)"
[ -n "$previous" ] && [ "$previous" != "$current" ] || exit 0

jobs="$(stale_jobs "$root/$previous" | sort -u)"
if [ -z "$jobs" ]; then
  # Nothing points at the old folder: the change is fully absorbed, so just remember it.
  printf '%s\n' "$current" > "$state" 2>/dev/null
  job_list="none found"
else
  job_list="$(printf '%s' "$jobs" | awk 'BEGIN { ORS = "; " } { print }' | sed 's/; $//')"
fi

prev_json="$(json_escape "$previous")"
cur_json="$(json_escape "$current")"
root_json="$(json_escape "$root")"
jobs_json="$(json_escape "$job_list")"
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "notes_repo in $root_json/.ai-notes/config.yml changed from '$prev_json' to '$cur_json' since the last session. Near the top of the conversation, alert the user that scheduled jobs (launchd agents, cron) may still point at the old folder and need updating. Scheduled jobs still referencing $root_json/$prev_json: $jobs_json. For each one, offer to fix it so it no longer hardcodes the notes repo: run the ainotes tools from the workspace root ($root_json) with no notes-repo path, since check-prs.sh and snapshot-agents.sh read notes_repo from config.yml on every run. Then reload it (launchctl unload/load -w for launchd). Change a job only if the user agrees. This alert repeats each session until no job references the old folder; if none was found, it won't repeat."
  }
}
EOF
