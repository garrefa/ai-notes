#!/bin/sh
# SessionStart hook: nudge Claude to offer session-scoped task tracking (ainotes-tasks skill).
#
# Only fires inside an ainotes-managed workspace: walks up from $CLAUDE_PROJECT_DIR (or $PWD) looking
# for the ainotes config (<notes repo>/.config.yml), and exits 0 silently if none is found. The notes
# repo named in the message is the folder holding that config.

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

# Print a top-level scalar key ($2) from a simple YAML file ($1) without needing yq: strips a
# trailing " # comment", surrounding quotes, and whitespace. Prints nothing if absent or null.
read_config_scalar() {
  sed -n "s/^$2:[[:space:]]*//p" "$1" | head -n 1 \
    | sed -e 's/[[:space:]]#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/" \
    | grep -vxE 'null|~' || true
}

# Escape a string for embedding inside a JSON string literal.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

config="$(find_ainotes_config "${CLAUDE_PROJECT_DIR:-$PWD}")" || exit 0
notes_repo="$(json_escape "$(notes_repo_name "$config")")"

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Near the top of this conversation (after understanding what the user is asking for, not before), ask whether they want to track this session's purpose as a task using the ainotes-tasks skill ($notes_repo/TASKS.md + $notes_repo/tasks/<slug>.md). Skip the ask if the session is clearly a trivial one-off question, or if a task-tracking skill (ainotes-task, ainotes-daily-plan, ainotes-tasks itself) already covers this session's purpose. If the user says yes, capture a short title and optional deadline and create the task per ainotes-tasks; since they're starting on it now, give it the second non-closed status from task_statuses in the ainotes config ($notes_repo/.config.yml; in-progress with the defaults) rather than the first. Status changes after that are only ever made when the user asks. If a Jira ticket or PR gets created later in this session for a task you created this way, update that task's file and TASKS.md row with the link before reporting it back to the user."
  }
}
EOF
