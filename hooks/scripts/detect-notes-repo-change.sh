#!/bin/sh
# SessionStart hook: notice when the workspace's notes folder (the folder holding the ainotes
# .config.yml) has been renamed since the last session, and have Claude alert the user to update any
# scheduled job that still points at the old folder: launchd agents in ~/Library/LaunchAgents and
# the user's crontab. A job that hardcodes the notes repo's path (e.g. check-prs.sh given an explicit
# PRS.md, or a WorkingDirectory inside it) silently stops working after a rename.
#
# The last name seen is kept in <notes repo>/.state/last-notes-repo, which moves with the folder, so
# a rename shows up as a stored name that differs from the folder's name (legacy layout:
# .ai-notes/.last-notes-repo vs the notes_repo key). The first run only records it. After a
# change, the new name is recorded once no scheduled job references the old folder any more, so the
# alert repeats every session until the jobs are fixed, then stops.
#
# Does nothing if no ainotes config is found. The session directory is the hook input's `cwd`,
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

# ainotes config discovery — keep in sync with tools/ainotes-config.sh. The config is
# <notes repo>/.config.yml (marked `kind: ainotes-config`); the folder holding it is the notes repo
# and its parent is the workspace root. A legacy <workspace>/.ai-notes/config.yml is still honored.
is_ainotes_config() {
  [ -f "$1" ] && grep -qE '^kind:[[:space:]]*["'"'"']?ainotes-config' "$1"
}

# Walk up from $1 (checking each directory and its immediate subfolders); print the config path.
find_ainotes_config() {
  dir="$1"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if is_ainotes_config "$dir/.config.yml"; then printf '%s\n' "$dir/.config.yml"; return 0; fi
    for candidate in "$dir"/*/.config.yml; do
      if is_ainotes_config "$candidate"; then printf '%s\n' "$candidate"; return 0; fi
    done
    if [ -f "$dir/.ai-notes/config.yml" ]; then printf '%s\n' "$dir/.ai-notes/config.yml"; return 0; fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# The notes folder's name for a config (legacy layout: its notes_repo key, default "notes").
notes_repo_name() {
  case "$1" in
    */.ai-notes/config.yml) name="$(read_config_scalar "$1" notes_repo)"; printf '%s\n' "${name:-notes}" ;;
    *) basename "$(dirname "$1")" ;;
  esac
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

config="$(find_ainotes_config "$cwd")" || exit 0
root="$(dirname "$(dirname "$config")")"
current="$(notes_repo_name "$config")"
[ -n "$current" ] || exit 0
# The tracker lives inside the notes folder (.state/ moves with it on a rename), so a rename shows up
# as a stored name that differs from the folder's current name. Legacy layout: .ai-notes/.last-notes-repo.
case "$config" in
  */.ai-notes/config.yml) state="$root/.ai-notes/.last-notes-repo" ;;
  *) state="$(dirname "$config")/.state/last-notes-repo"; mkdir -p "$(dirname "$state")" 2>/dev/null ;;
esac

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
    "additionalContext": "The notes folder in $root_json changed from '$prev_json' to '$cur_json' since the last session. Near the top of the conversation, alert the user that scheduled jobs (launchd agents, cron) may still point at the old folder and need updating. Scheduled jobs still referencing $root_json/$prev_json: $jobs_json. ainotes's own jobs (launchd label com.ainotes.*, crontab tag ainotes-schedule:) are fixed with .claude/tools/schedule.sh apply. For any other, offer to fix it so it no longer hardcodes the notes repo: run the ainotes tools from the workspace root ($root_json) with no notes-repo path, since check-prs.sh and snapshot-agents.sh locate the notes repo on every run. Then reload it (launchctl unload/load -w for launchd). Change a job only if the user agrees. This alert repeats each session until no job references the old folder; if none was found, it won't repeat."
  }
}
EOF
