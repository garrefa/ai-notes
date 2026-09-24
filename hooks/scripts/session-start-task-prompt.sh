#!/bin/sh
# SessionStart hook: nudge Claude to offer session-scoped task tracking (ainotes-tasks skill).
#
# Only fires inside an ainotes-managed workspace: walks up from $CLAUDE_PROJECT_DIR (or $PWD) looking
# for a directory containing .ai-notes/config.yml, and exits 0 silently if none is found. The notes
# repo named in the message comes from that config's `notes_repo` key (default: notes).

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

root="$(find_workspace_root "${CLAUDE_PROJECT_DIR:-$PWD}")" || exit 0
notes_repo="$(read_config_scalar "$root/.ai-notes/config.yml" notes_repo)"
notes_repo="$(json_escape "${notes_repo:-notes}")"

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Near the top of this conversation (after understanding what the user is asking for, not before), ask whether they want to track this session's purpose as a task using the ainotes-tasks skill ($notes_repo/db/TASKS.md + $notes_repo/db/tasks/<slug>.md). Skip the ask if the session is clearly a trivial one-off question, or if a task-tracking skill (ainotes-task, ainotes-daily-plan, ainotes-tasks itself) already covers this session's purpose. If the user says yes, capture a short title and optional deadline and create the task per ainotes-tasks; since they're starting on it now, give it the second non-closed status from task_statuses in .ai-notes/config.yml (in-progress with the defaults) rather than the first. Status changes after that are only ever made when the user asks. If a Jira ticket or PR gets created later in this session for a task you created this way, update that task's file and db/TASKS.md row with the link before reporting it back to the user."
  }
}
EOF
