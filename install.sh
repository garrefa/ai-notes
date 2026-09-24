#!/usr/bin/env bash
# install.sh — copy the ainotes toolkit into a workspace's .claude/ directory.
#
# Use this instead of the Claude Code plugin if you'd rather vendor the files (e.g. to commit them
# alongside a shared workspace, or to customize the skills in place).
#
#   ./install.sh [--force] [--dry-run] <workspace-dir>
#   ./install.sh --uninstall [--dry-run] <workspace-dir>
#
# What it does (install):
#   skills/ainotes-*        -> <ws>/.claude/skills/
#   agents/*.md             -> <ws>/.claude/agents/
#   hooks/scripts/*.sh      -> <ws>/.claude/hooks/
#   tools/*                 -> <ws>/.claude/tools/
#   templates/notes-repo    -> <ws>/.claude/templates/notes-repo/
#   hook wiring             -> merged into <ws>/.claude/settings.json (existing settings are kept)
#
# It never creates .ai-notes/config.yml or the notes repo — run "setup ainotes" in Claude Code
# from the workspace afterwards; the ainotes-setup skill asks the questions and creates both.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=0 DRY_RUN=0 UNINSTALL=0 WS=""

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage 0 ;;
    -*) echo "unknown option: $1" >&2; usage 1 ;;
    *) [ -z "$WS" ] || { echo "only one workspace dir allowed" >&2; exit 1; }; WS="$1" ;;
  esac
  shift
done
[ -n "$WS" ] || usage 1
[ -d "$WS" ] || { echo "not a directory: $WS" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required (used to merge settings.json)" >&2; exit 1; }

WS="$(cd "$WS" && pwd)"
DEST="$WS/.claude"
SETTINGS="$DEST/settings.json"
HOOK_SCRIPTS=(session-start-task-prompt.sh detect-unregistered-repo.sh detect-repo-clone.sh)

run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
log() { echo "ainotes: $*"; }

# Copy one directory, refusing to clobber an existing one unless --force.
copy_dir() {
  local from="$1" to="$2"
  if [ -e "$to" ] && [ "$FORCE" != 1 ]; then
    log "skip $to (exists; use --force to overwrite)"
    return
  fi
  run rm -rf "$to"
  run mkdir -p "$(dirname "$to")"
  run cp -R "$from" "$to"
  log "installed $to"
}

copy_file() {
  local from="$1" to="$2"
  if [ -e "$to" ] && [ "$FORCE" != 1 ]; then
    log "skip $to (exists; use --force to overwrite)"
    return
  fi
  run mkdir -p "$(dirname "$to")"
  run cp -p "$from" "$to"
  log "installed $to"
}

# Add (or, with "remove", strip) this toolkit's hook entries in settings.json. Idempotent: an entry is
# identified by its command string, so re-running install never duplicates hooks.
edit_settings() {
  local mode="$1"
  if [ "$DRY_RUN" = 1 ]; then echo "would: $mode ainotes hooks in $SETTINGS"; return; fi
  mkdir -p "$DEST"
  python3 - "$SETTINGS" "$mode" <<'PY'
import json, os, sys
path, mode = sys.argv[1], sys.argv[2]
cmd = lambda name: f'"${{CLAUDE_PROJECT_DIR}}/.claude/hooks/{name}"'
wanted = {
    "SessionStart": [("startup", cmd("session-start-task-prompt.sh")), ("startup", cmd("detect-unregistered-repo.sh"))],
    "PostToolUse": [("Bash", cmd("detect-repo-clone.sh"))],
}
ours = {c for entries in wanted.values() for _, c in entries}
settings = json.load(open(path)) if os.path.exists(path) and os.path.getsize(path) else {}
hooks = settings.setdefault("hooks", {})

def present(groups, command):
    return any(h.get("command") == command for g in groups for h in g.get("hooks", []))

if mode == "add":
    for event, entries in wanted.items():
        groups = hooks.setdefault(event, [])
        for matcher, command in entries:
            if present(groups, command):
                continue
            group = next((g for g in groups if g.get("matcher") == matcher), None)
            if group is None:
                group = {"matcher": matcher, "hooks": []} if matcher else {"hooks": []}
                groups.append(group)
            group["hooks"].append({"type": "command", "command": command, "timeout": 5})
else:
    for event in list(hooks):
        for g in hooks[event]:
            g["hooks"] = [h for h in g.get("hooks", []) if h.get("command") not in ours]
        hooks[event] = [g for g in hooks[event] if g["hooks"]]
        if not hooks[event]:
            del hooks[event]
    if not hooks:
        del settings["hooks"]

with open(path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PY
  if [ "$mode" = add ]; then log "wired hooks in $SETTINGS"; else log "removed hooks from $SETTINGS"; fi
}

if [ "$UNINSTALL" = 1 ]; then
  for s in "$SRC"/skills/ainotes-*; do run rm -rf "$DEST/skills/$(basename "$s")"; done
  for a in "$SRC"/agents/*.md; do run rm -f "$DEST/agents/$(basename "$a")"; done
  for h in "${HOOK_SCRIPTS[@]}"; do run rm -f "$DEST/hooks/$h"; done
  for t in "$SRC"/tools/*; do run rm -f "$DEST/tools/$(basename "$t")"; done
  run rm -rf "$DEST/templates/notes-repo"
  for d in tools templates agents hooks skills; do [ -d "$DEST/$d" ] && run rmdir "$DEST/$d" 2>/dev/null || true; done
  [ -f "$SETTINGS" ] && edit_settings remove
  log "uninstalled from $WS (.ai-notes/ and your notes repo were left untouched)"
  exit 0
fi

for s in "$SRC"/skills/ainotes-*; do copy_dir "$s" "$DEST/skills/$(basename "$s")"; done
for a in "$SRC"/agents/*.md; do copy_file "$a" "$DEST/agents/$(basename "$a")"; done
for h in "${HOOK_SCRIPTS[@]}"; do copy_file "$SRC/hooks/scripts/$h" "$DEST/hooks/$h"; done
for t in "$SRC"/tools/*; do copy_file "$t" "$DEST/tools/$(basename "$t")"; done
copy_dir "$SRC/templates/notes-repo" "$DEST/templates/notes-repo"
edit_settings add

cat <<EOF

Done. Next steps:
  1. cd "$WS" && claude
  2. Say "setup ainotes" — it creates .ai-notes/config.yml and (optionally) your notes repo.
EOF
