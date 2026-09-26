# shellcheck shell=bash
#
# ainotes-config.sh — shared helpers for the tools/ scripts: find an ainotes
# workspace and read scalars from its .ai-notes/config.yml without needing yq.
# Source it; it defines functions only and has no side effects.

# Walk up from $1 until a directory containing .ai-notes/ turns up.
find_workspace_root() {
  local dir="$1"
  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if [[ -d "$dir/.ai-notes" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# Print a scalar from a simple YAML file: `config_value FILE key` for a
# top-level key, `config_value FILE parent key` for a key nested one level
# under a top-level block. Strips comments, quotes, and whitespace; prints
# nothing for a missing key or a null value.
config_value() {
  local file="$1" parent key
  if [[ $# -eq 3 ]]; then parent="$2"; key="$3"; else parent=""; key="$2"; fi
  awk -v parent="$parent" -v key="$key" '
    { sub(/(^|[ \t])#.*$/, "") }
    /^[^ \t]/ { inblock = (parent != "" && $0 ~ ("^" parent ":")) }
    {
      if (parent == "") { if ($0 !~ ("^" key ":")) next }
      else { if (!inblock || $0 !~ ("^[ \t]+" key ":")) next }
      v = $0; sub(/^[ \t]*[^:]*:[ \t]*/, "", v); sub(/[ \t]+$/, "", v)
      gsub(/^["\047]|["\047]$/, "", v)
      if (v != "null" && v != "~") print v
      exit
    }
  ' "$file"
}
