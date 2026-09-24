#!/bin/sh
# PostToolUse hook (matcher: Bash): nudge the ainotes-setup skill right after a `git clone` lands a
# new top-level repo directly in the workspace root. Best-effort command parsing — covers the common
# `git clone <url> [<dir>]` forms (including common flags like --branch/-b, --depth, --origin/-o
# with their value skipped), and stops at the first shell control operator (`&&`, `||`, `;`, `|`,
# even when glued to a word like `dest;`) so chained commands aren't mistaken for clone args;
# exotic invocations may be missed, in which case the SessionStart hook
# (detect-unregistered-repo.sh) still catches it the next time a session starts in that repo.
#
# Reads the hook input's `command` and `cwd` (via jq, or python3 if jq is absent; exits 0 silently
# with neither). The workspace root is found by walking up from that `cwd` (falling back to
# $CLAUDE_PROJECT_DIR, then $PWD) for .ai-notes/config.yml; exits 0 silently if there is none.

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

command -v jq >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || exit 0

input="$(cat)"
command="$(printf '%s' "$input" | read_input_field tool_input.command)"
cwd="$(printf '%s' "$input" | read_input_field cwd)"
cwd="${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"
[ -n "$command" ] || exit 0

case "$command" in
  *"git clone"*) ;;
  *) exit 0 ;;
esac

root="$(find_workspace_root "$cwd")" || exit 0

# Pull out everything after the "clone" token, pad every control-operator character (; & |) with
# spaces so one glued to a word becomes its own token, then walk it word by word (unquoted
# word-splitting — fine for the overwhelmingly common case of URLs/paths with no spaces), stopping
# at the first operator token.
rest="$(printf '%s' "$command" | sed -n 's/.*git clone //p' | head -1 | sed 's/[;&|]/ & /g')"
[ -n "$rest" ] || exit 0

url=""
dest=""
skip_next=0
set -f  # no globbing while word-splitting $rest
# shellcheck disable=SC2086
set -- $rest
set +f
for word in "$@"; do
  case "$word" in
    ";"|"&"|"|") break ;;
  esac
  if [ "$skip_next" = 1 ]; then
    skip_next=0
    continue
  fi
  case "$word" in
    --branch|-b|--depth|--origin|-o|--config|-c|--template|--reference|--jobs|-j)
      skip_next=1
      continue
      ;;
    -*)
      continue
      ;;
  esac
  if [ -z "$url" ]; then
    url="$word"
  elif [ -z "$dest" ]; then
    dest="$word"
  fi
done
[ -n "$url" ] || exit 0

if [ -z "$dest" ]; then
  dest="$(printf '%s' "$url" | sed 's:/$::' | sed 's:\.git$::' | sed 's:.*/::')"
fi
[ -n "$dest" ] || exit 0

case "$dest" in
  /*) full="$dest" ;;
  *) full="$cwd/$dest" ;;
esac

# Only nudge for a new *top-level* repo (landed directly in the workspace root) that actually exists
# and is a real git repo now — guards against a failed clone or one nested somewhere else entirely.
[ "$(dirname "$full")" = "$root" ] || exit 0
[ -d "$full/.git" ] || exit 0

repo="$(basename "$full")"
config="$root/.ai-notes/config.yml"
notes_repo="$(read_config_scalar "$config" notes_repo)"

case "$repo" in
  ""|.ai-notes|.claude|"${notes_repo:-notes}")
    exit 0
    ;;
esac

if registered_repos "$config" | grep -qxF "$repo"; then
  exit 0
fi

repo_json="$(json_escape "$repo")"
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "You just cloned '$repo_json' into the workspace root. Invoke the ainotes-setup skill's repo-registration flow scoped to just this one new repo: ask the user whether to tag it with a domain (suggest based on name/stack similarity to existing domains) or mark it ignored, then update .ai-notes/config.yml accordingly."
  }
}
EOF
