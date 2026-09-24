#!/bin/sh
# SessionStart hook: nudge the ainotes-setup skill when the session's current repo is neither
# tagged in domain_taxonomy nor listed in ignored_repos in the workspace's
# .ai-notes/config.yml. Does nothing if no .ai-notes/config.yml is found at all (not a managed
# workspace, or ainotes-setup hasn't been run here yet) — this hook never suggests creating one
# unprompted.
#
# The session directory is the hook input's `cwd`, falling back to $CLAUDE_PROJECT_DIR, then $PWD.
# Needs jq or python3 only to read that `cwd` field; without either it just uses the fallbacks.

# Print a string field from the hook's JSON input on stdin, or nothing. $1 is a dotted path
# (e.g. "cwd" or "tool_input.command").
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

# Print a top-level scalar key ($2) from a simple YAML file ($1) without needing yq: strips a
# trailing " # comment", surrounding quotes, and whitespace. Prints nothing if absent or null.
read_config_scalar() {
  sed -n "s/^$2:[[:space:]]*//p" "$1" | head -n 1 \
    | sed -e 's/[[:space:]]#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/" \
    | grep -vxE 'null|~' || true
}

# Print every repo name listed under `ignored_repos` or anywhere in `domain_taxonomy`, one per
# line. Handles both flow lists (`[a, b]`, also inside a flow map) and block lists (`- a`).
registered_repos() {
  awk '
    function emit(s) {
      gsub(/^[ \t"'\'']+|[ \t"'\'']+$/, "", s)
      if (s != "") print s
    }
    { sub(/(^|[ \t])#.*$/, "") }
    /^[A-Za-z_][A-Za-z0-9_]*:/ { insec = ($0 ~ /^(ignored_repos|domain_taxonomy):/) }
    !insec { next }
    {
      line = $0
      while (match(line, /\[[^]]*\]/)) {
        n = split(substr(line, RSTART + 1, RLENGTH - 2), items, ",")
        for (i = 1; i <= n; i++) emit(items[i])
        line = substr(line, RSTART + RLENGTH)
      }
      if ($0 ~ /^[ \t]*-[ \t]/) { item = $0; sub(/^[ \t]*-[ \t]*/, "", item); emit(item) }
    }
  ' "$1"
}

# Escape a string for embedding inside a JSON string literal.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cwd="$(read_input_field cwd)"
cwd="${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"

root="$(find_workspace_root "$cwd")" || exit 0
config="$root/.ai-notes/config.yml"
notes_repo="$(read_config_scalar "$config" notes_repo)"

# First path segment under the workspace root is the repo name, whether cwd is a repo's root
# checkout or already inside <repo>/.worktrees/<name> or <repo>/.claude/worktrees/<name>.
case "$cwd" in
  "$root"/*) rest="${cwd#"$root"/}"; repo="${rest%%/*}" ;;
  *) exit 0 ;;
esac

case "$repo" in
  ""|.ai-notes|.claude|"${notes_repo:-notes}")
    exit 0
    ;;
esac

# Only nudge about real repos — not an arbitrary scratch directory at the workspace root.
[ -e "$root/$repo/.git" ] || exit 0

if registered_repos "$config" | grep -qxF "$repo"; then
  exit 0
fi

repo_json="$(json_escape "$repo")"
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "This session started in '$repo_json', which isn't yet registered in this workspace's .ai-notes/config.yml (not tagged in domain_taxonomy, not in ignored_repos). Near the top of the conversation, invoke the ainotes-setup skill's repo-registration flow scoped to just this one repo: ask the user whether to tag it with a domain (suggest based on name/stack similarity to existing domains) or mark it ignored, then update the config accordingly. Don't scan or ask about any other unregistered repos in the same breath — just this one."
  }
}
EOF
