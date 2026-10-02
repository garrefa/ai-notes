# shellcheck shell=bash
#
# ainotes-config.sh — shared helpers for the tools/ scripts: find an ainotes workspace, its notes
# repo and its config, and read scalars from the config without needing yq. Source it; it defines
# functions only and has no side effects.
#
# Where things live: the config is `.config.yml` inside the notes repo, marked by a top-level
# `kind: ainotes-config` line. The folder holding it IS the notes repo, and that folder's parent is
# the workspace root, so renaming the notes folder needs no config edit. Untracked runtime files
# (caches, logs, rename tracker) go in `<notes repo>/.state/`. A legacy
# `<workspace>/.ai-notes/config.yml` (notes repo named by its `notes_repo` key) is still honored
# until install.sh migrates it.
#
# The hooks/scripts/*.sh hooks can't source this file (they're installed apart from tools/), so
# each carries a copy of find_ainotes_config. Keep those copies in sync with this one.

# is_ainotes_config FILE — true if FILE is an ainotes config (new layout marker)
is_ainotes_config() {
  [[ -f "$1" ]] && grep -qE '^kind:[[:space:]]*["\047]?ainotes-config' "$1"
}

# find_ainotes_config DIR — walk up from DIR and print the config's path. At each level: DIR's own
# .config.yml (we're inside the notes repo), then an immediate subfolder's .config.yml (DIR is the
# workspace root), then a legacy DIR/.ai-notes/config.yml.
find_ainotes_config() {
  local dir="$1" candidate
  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if is_ainotes_config "$dir/.config.yml"; then echo "$dir/.config.yml"; return 0; fi
    for candidate in "$dir"/*/.config.yml; do
      if is_ainotes_config "$candidate"; then echo "$candidate"; return 0; fi
    done
    if [[ -f "$dir/.ai-notes/config.yml" ]]; then echo "$dir/.ai-notes/config.yml"; return 0; fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# config_is_legacy CONFIG — true for <workspace>/.ai-notes/config.yml
config_is_legacy() { [[ "$1" == */.ai-notes/config.yml ]]; }

# workspace_root_of CONFIG — the workspace root a config belongs to
workspace_root_of() { dirname "$(dirname "$1")"; }

# notes_dir_of CONFIG — the notes repo a config belongs to (empty if a legacy config names none)
notes_dir_of() {
  local config="$1" name
  if config_is_legacy "$config"; then
    name="$(config_value "$config" notes_repo)"
    [[ -n "$name" ]] && echo "$(workspace_root_of "$config")/$name"
  else
    dirname "$config"
  fi
}

# state_dir_of CONFIG — where untracked runtime files go (created on demand by writers)
state_dir_of() {
  if config_is_legacy "$1"; then dirname "$1"; else echo "$(dirname "$1")/.state"; fi
}

# find_workspace_root DIR — kept for existing callers: the workspace root above DIR
find_workspace_root() {
  local config
  config="$(find_ainotes_config "$1")" || return 1
  workspace_root_of "$config"
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
