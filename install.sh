#!/usr/bin/env bash
# install.sh — copy the ainotes toolkit into a workspace's .claude/ directory.
#
# Use this instead of the Claude Code plugin if you'd rather vendor the files (e.g. to commit them
# alongside a shared workspace, or to customize the skills in place).
#
#   ./install.sh [--force] [--dry-run] [--no-schedule] <workspace-dir>
#   ./install.sh --uninstall [--dry-run] <workspace-dir>
#
# What it does (install):
#   skills/ainotes-*        -> <ws>/.claude/skills/
#   agents/*.md             -> <ws>/.claude/agents/
#   hooks/scripts/*.sh      -> <ws>/.claude/hooks/
#   tools/*                 -> <ws>/.claude/tools/
#   templates/notes-repo    -> <ws>/.claude/templates/notes-repo/
#   hook wiring             -> merged into <ws>/.claude/settings.json (existing settings are kept)
#   notes repo's db/ layout -> migrated up a level in place, if an older repo still has one
#   tools/snapshot-agents.sh -> offered on a schedule (launchd on macOS, cron elsewhere) — see below
#
# It never creates .ai-notes/config.yml or the notes repo — run "setup ainotes" in Claude Code
# from the workspace afterwards; the ainotes-setup skill asks the questions and creates both. It
# DOES fix up an existing notes repo that predates the flat layout: if `.ai-notes/config.yml`
# points at one with a `db/` folder (db/notes, db/PRS.md, ...), that folder's contents are moved up
# to the repo root and the empty `db/` is removed, on every run (not just --force — this is data
# layout, not a toolkit file to protect). Safe to re-run: a no-op once there's no `db/` left.
#
# Scheduling snapshot-agents.sh: when run interactively (a real terminal, not CI/a script feeding
# stdin) and not `--dry-run`, install asks once whether to schedule it to run every 60s — needed
# for the viewer's Agents view to have anything to show. Say yes and it sets up a per-user launchd
# job (macOS) or a crontab line (everything else) for you; say no (or pass --no-schedule to skip
# the question outright) and nothing is touched — schedule it yourself later however you like.
# Re-running install replaces its own entry rather than duplicating it. --uninstall always removes
# it, no asking, if this script was the one that set it up.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=0 DRY_RUN=0 UNINSTALL=0 NO_SCHEDULE=0 WS=""

usage() { sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --no-schedule) NO_SCHEDULE=1 ;;
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

# Stable per-workspace identifier for the optional schedule below, so re-running install replaces
# its own entry instead of duplicating it, and installing into more than one workspace never
# collides. cksum is POSIX and needs no extra dependency beyond what's already required.
WS_ID="$(printf '%s' "$WS" | cksum | cut -d' ' -f1)"
LAUNCHD_LABEL="com.ainotes.snapshot-agents.$WS_ID"
CRON_MARKER="# ainotes-snapshot-agents:$WS_ID ($WS)"

# shellcheck source=tools/ainotes-config.sh
source "$SRC/tools/ainotes-config.sh"

run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
log() { echo "ainotes: $*"; }

# If .ai-notes/config.yml points at a notes repo that still has the old db/ layout (db/notes,
# db/PRS.md, ...), move everything up to the repo root and remove the empty db/. A no-op when
# there's no config yet, no notes repo yet, or the repo is already flat. Runs regardless of --force
# (this fixes a data layout, not a toolkit file), and honors --dry-run like everything else here.
migrate_notes_repo() {
  local config="$WS/.ai-notes/config.yml"
  [ -f "$config" ] || return 0

  local notes_repo notes_dir db_dir entry base dest
  notes_repo="$(config_value "$config" notes_repo)"
  notes_dir="$WS/${notes_repo:-notes}"
  db_dir="$notes_dir/db"
  [ -d "$db_dir" ] || return 0

  log "found an older notes repo layout at $db_dir — migrating up to $notes_dir/"
  for entry in "$db_dir"/* "$db_dir"/.[!.]*; do
    [ -e "$entry" ] || continue
    base="$(basename "$entry")"
    dest="$notes_dir/$base"
    if [ -e "$dest" ]; then
      echo "ainotes: refusing to migrate $entry — $dest already exists; move it by hand and re-run" >&2
      exit 1
    fi
    run mv "$entry" "$dest"
    log "moved db/$base -> $base"
  done
  run rmdir "$db_dir"
  [ "$DRY_RUN" = 1 ] || log "removed empty $db_dir"
}

# --- optional: schedule tools/snapshot-agents.sh ----------------------------------------------

launchd_plist_path() { echo "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"; }

schedule_launchd() {
  local script="$1" plist
  plist="$(launchd_plist_path)"
  if [ "$DRY_RUN" = 1 ]; then
    echo "would: write $plist and load it with launchctl (every 60s)"
    return 0
  fi
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$script</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$WS/.ai-notes/snapshot-agents.log</string>
  <key>StandardErrorPath</key><string>$WS/.ai-notes/snapshot-agents.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$plist" >/dev/null 2>&1 || true
  if launchctl load -w "$plist" 2>/dev/null; then
    log "scheduled via launchd: $plist (every 60s; logs at $WS/.ai-notes/snapshot-agents.log)"
  else
    echo "ainotes: wrote $plist but 'launchctl load' failed — load it yourself: launchctl load -w \"$plist\"" >&2
  fi
}

unschedule_launchd() {
  local plist
  plist="$(launchd_plist_path)"
  [ -f "$plist" ] || return 0
  run launchctl unload "$plist"
  run rm -f "$plist"
  log "removed launchd job $plist"
}

schedule_cron() {
  local script="$1"
  if [ "$DRY_RUN" = 1 ]; then
    echo "would: add a crontab line running $script every minute"
    return 0
  fi
  command -v crontab >/dev/null 2>&1 || {
    echo "ainotes: no crontab command found — schedule $script yourself" >&2
    return 0
  }
  { crontab -l 2>/dev/null | grep -vF "$CRON_MARKER"
    printf '* * * * * %s %s\n' "$script" "$CRON_MARKER"
  } | crontab -
  log "scheduled via cron: runs every minute ($CRON_MARKER)"
}

unschedule_cron() {
  command -v crontab >/dev/null 2>&1 || return 0
  crontab -l 2>/dev/null | grep -qF "$CRON_MARKER" || return 0
  if [ "$DRY_RUN" = 1 ]; then
    echo "would: remove the crontab entry for this workspace"
    return 0
  fi
  crontab -l 2>/dev/null | grep -vF "$CRON_MARKER" | crontab -
  log "removed crontab entry for this workspace"
}

# Asks once (only in a real terminal, only outside --dry-run/--no-schedule) whether to schedule
# snapshot-agents.sh, and does it with whichever of launchd/cron fits the OS. A "no" (or a
# non-interactive run) leaves everything untouched — the viewer's Agents view just stays empty
# until AGENTS.json exists some other way.
maybe_schedule_snapshot_agents() {
  local script="$DEST/tools/snapshot-agents.sh"

  if [ "$DRY_RUN" = 1 ]; then
    echo "would: ask whether to schedule $script every 60s (launchd on macOS, cron elsewhere) — skip with --no-schedule"
    return 0
  fi
  if [ "$NO_SCHEDULE" = 1 ]; then
    log "skipping the scheduling question (--no-schedule)"
    return 0
  fi
  [ -t 0 ] || return 0

  echo
  echo "ainotes: the viewer's Agents view is fed by tools/snapshot-agents.sh, refreshed on a"
  echo "schedule. Set it up to run every 60 seconds now?"
  read -r -p "  [y/N] " reply
  case "$reply" in
    y|Y|yes|Yes|YES) ;;
    *)
      log "not scheduled — run \"$script\" by hand, or set up your own cron/launchd job later"
      return 0
      ;;
  esac

  case "$(uname -s)" in
    Darwin) schedule_launchd "$script" ;;
    *) schedule_cron "$script" ;;
  esac
}

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
  case "$(uname -s)" in
    Darwin) unschedule_launchd ;;
    *) unschedule_cron ;;
  esac
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

migrate_notes_repo

for s in "$SRC"/skills/ainotes-*; do copy_dir "$s" "$DEST/skills/$(basename "$s")"; done
for a in "$SRC"/agents/*.md; do copy_file "$a" "$DEST/agents/$(basename "$a")"; done
for h in "${HOOK_SCRIPTS[@]}"; do copy_file "$SRC/hooks/scripts/$h" "$DEST/hooks/$h"; done
for t in "$SRC"/tools/*; do copy_file "$t" "$DEST/tools/$(basename "$t")"; done
copy_dir "$SRC/templates/notes-repo" "$DEST/templates/notes-repo"
# When this script runs from the npm package (`npx ainotes-viewer install`), the template's
# .gitignore arrives as "gitignore" — npm drops dotted .gitignore files from tarballs — so put the
# dot back. A no-op for an install from a clone, where the file already has its real name.
if [ -f "$DEST/templates/notes-repo/gitignore" ] && [ ! -e "$DEST/templates/notes-repo/.gitignore" ]; then
  run mv "$DEST/templates/notes-repo/gitignore" "$DEST/templates/notes-repo/.gitignore"
fi
edit_settings add
maybe_schedule_snapshot_agents

cat <<EOF

Done. Next steps:
  1. cd "$WS" && claude
  2. Say "setup ainotes" — it creates .ai-notes/config.yml and (optionally) your notes repo.
EOF
