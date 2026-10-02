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
#   templates/workspace/run-viewer -> <ws>/bin/run-viewer (opens the viewer via npx; replaces an
#                           older <ws>/run-viewer.sh that this script installed)
#   hook wiring             -> merged into <ws>/.claude/settings.json (existing settings are kept)
#   notes repo's db/ layout -> migrated up a level in place, if an older repo still has one
#   tools/snapshot-agents.sh -> offered on a schedule (launchd on macOS, cron elsewhere) — see below
#
# It never creates the config or the notes repo — run "setup ainotes" in Claude Code from the
# workspace afterwards; the ainotes-setup skill asks the questions and creates both (the config is
# <notes repo>/.config.yml). On every run (not just --force — this is data layout, not a toolkit
# file to protect), and honoring --dry-run, it migrates older layouts in place:
#   - a legacy <ws>/.ai-notes/config.yml moves to <notes repo>/.config.yml (gaining the
#     `kind: ainotes-config` marker, losing the notes_repo key); .ai-notes/ runtime files
#     (default-branches.txt, .last-notes-repo, snapshot-agents.log) move to <notes repo>/.state/;
#     the emptied .ai-notes/ is removed;
#   - an older <ws>/.dm-pr-review/ moves to <notes repo>/.dm-pr-review/, its config.yml folded into
#     the config's dm_pr_review: section;
#   - a notes repo still using the db/ layout (db/notes, db/PRS.md, ...) is flattened to its root.
# It also makes sure <notes repo>/.dm-pr-review/ exists and that the notes repo's .gitignore
# ignores .state/ and everything in .dm-pr-review/ except ledger.jsonl. Safe to re-run: each step is
# a no-op once done.
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

usage() { sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

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
HOOK_SCRIPTS=(session-start-task-prompt.sh detect-unregistered-repo.sh detect-notes-repo-change.sh detect-repo-clone.sh)
# In tools/ but not part of a workspace install: release.sh cuts releases of this repo. Older
# versions of this script installed it anyway, so install and uninstall both remove a stale copy.
MAINTAINER_TOOLS=(release.sh)

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

# workspace_config — this workspace's ainotes config (new or legacy layout); fails if there's none.
workspace_config() {
  local c
  c="$(find_ainotes_config "$WS")" || return 1
  [ "$(workspace_root_of "$c")" = "$WS" ] || return 1
  echo "$c"
}

# Move a legacy .ai-notes/config.yml into the notes repo it names, as .config.yml (marker added,
# notes_repo dropped), and .ai-notes/ runtime files into <notes repo>/.state/. Never overwrites: if
# the destination already exists it warns and leaves both for you to reconcile.
migrate_config() {
  local legacy="$WS/.ai-notes/config.yml" notes_repo notes_dir new pair from to
  [ -f "$legacy" ] || return 0
  notes_repo="$(config_value "$legacy" notes_repo)"
  notes_dir="$WS/${notes_repo:-notes}"
  if [ ! -d "$notes_dir" ]; then
    echo "ainotes: $legacy names notes repo '${notes_repo:-notes}', but $notes_dir doesn't exist — not migrating it; run \"setup ainotes\"" >&2
    return 0
  fi
  new="$notes_dir/.config.yml"
  if [ -e "$new" ]; then
    echo "ainotes: both $legacy and $new exist — leaving both; merge them by hand and delete $legacy" >&2
    return 0
  fi

  if [ "$DRY_RUN" = 1 ]; then
    echo "would: write $new (kind: ainotes-config + $legacy without its notes_repo key) and remove $legacy"
  else
    { printf '# ainotes config: moved here from .ai-notes/config.yml by install.sh on %s.\n' "$(date +%F)"
      printf '# The folder holding this file is the notes repo; see tools/config.example.yml for every key.\n'
      printf 'kind: ainotes-config\n\n'
      grep -vE '^notes_repo:' "$legacy"
    } > "$new.tmp"
    mv "$new.tmp" "$new"
    rm -f "$legacy"
  fi
  log "moved .ai-notes/config.yml -> ${notes_repo:-notes}/.config.yml"

  for pair in default-branches.txt:default-branches.txt .last-notes-repo:last-notes-repo snapshot-agents.log:snapshot-agents.log; do
    from="$WS/.ai-notes/${pair%%:*}"
    to="$notes_dir/.state/${pair#*:}"
    [ -e "$from" ] || continue
    if [ -e "$to" ]; then log "kept existing $to; left $from in place"; continue; fi
    run mkdir -p "$notes_dir/.state"
    run mv "$from" "$to"
    log "moved .ai-notes/${pair%%:*} -> ${notes_repo:-notes}/.state/${pair#*:}"
  done

  if [ "$DRY_RUN" = 1 ]; then
    echo "would: remove $WS/.ai-notes if it's empty"
  elif rmdir "$WS/.ai-notes" 2>/dev/null; then
    log "removed empty $WS/.ai-notes"
  else
    log "left $WS/.ai-notes in place — it still holds: $(ls -A "$WS/.ai-notes" | tr '\n' ' ')"
  fi
}

# Move an older <ws>/.dm-pr-review/ (PR auto-reviewer state) into the notes repo, folding its
# config.yml into the ainotes config's dm_pr_review: section.
migrate_dm_pr_review() {
  local old="$WS/.dm-pr-review" config notes_dir dest oldcfg
  [ -d "$old" ] || return 0
  if ! config="$(workspace_config)" || config_is_legacy "$config"; then
    [ "$DRY_RUN" = 1 ] && echo "would: move $old into the notes repo once the config has been migrated"
    return 0
  fi
  notes_dir="$(notes_dir_of "$config")"
  dest="$notes_dir/.dm-pr-review"
  if [ -e "$dest" ]; then
    echo "ainotes: both $old and $dest exist — leaving both; merge them by hand" >&2
    return 0
  fi
  oldcfg="$old/config.yml"
  if [ -f "$oldcfg" ] && ! grep -qE '^dm_pr_review:' "$config"; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "would: append a dm_pr_review: section to $config from $oldcfg"
    else
      { printf '\n# PR auto-reviewer (ainotes-dm-pr-review); merged from .dm-pr-review/config.yml by install.sh.\n'
        printf 'dm_pr_review:\n'
        dm_setting self_github_login "$oldcfg" self_github_login
        dm_setting review_model "$oldcfg" models review
        dm_setting review_level "$oldcfg" review level
        dm_setting per_review_budget_usd "$oldcfg" review per_review_budget_usd
        dm_setting monthly_budget_usd "$oldcfg" budget monthly_usd
      } >> "$config"
      log "merged $oldcfg into the dm_pr_review: section of $config"
    fi
  fi
  [ -f "$oldcfg" ] && run rm -f "$oldcfg"
  run mv "$old" "$dest"
  log "moved $old -> $dest"
}

# dm_setting NEW_KEY FILE OLD_KEY... — print "  NEW_KEY: value" when FILE has OLD_KEY (config_value args)
dm_setting() {
  local key="$1" file="$2" value
  shift 2
  value="$(config_value "$file" "$@")"
  if [ -n "$value" ]; then printf '  %s: %s\n' "$key" "$value"; fi
}

# Every run: make sure the notes repo has its .dm-pr-review/ folder and ignores runtime state
# (.state/, and everything in .dm-pr-review/ except the spend ledger).
prepare_notes_repo() {
  local config notes_dir gi line
  config="$(workspace_config)" || return 0
  config_is_legacy "$config" && return 0
  notes_dir="$(notes_dir_of "$config")"
  [ -d "$notes_dir/.dm-pr-review" ] || { run mkdir -p "$notes_dir/.dm-pr-review"; log "created $notes_dir/.dm-pr-review"; }
  gi="$notes_dir/.gitignore"
  for line in '.state/' '.dm-pr-review/*' '!.dm-pr-review/ledger.jsonl'; do
    grep -qxF -- "$line" "$gi" 2>/dev/null && continue
    if [ "$DRY_RUN" = 1 ]; then echo "would: add '$line' to $gi"; else printf '%s\n' "$line" >> "$gi"; log "added '$line' to $gi"; fi
  done
}

# snapshot_log_path — where the scheduled snapshot-agents.sh logs (the notes repo's .state/)
snapshot_log_path() {
  local config
  if config="$(workspace_config)" && ! config_is_legacy "$config"; then
    echo "$(state_dir_of "$config")/snapshot-agents.log"
  else
    echo "$WS/.ai-notes/snapshot-agents.log"
  fi
}

# If the notes repo still has the old db/ layout (db/notes, db/PRS.md, ...), move everything up to
# the repo root and remove the empty db/. A no-op when there's no config yet, no notes repo yet, or
# the repo is already flat.
migrate_notes_repo() {
  local config
  config="$(workspace_config)" || return 0

  local notes_repo notes_dir db_dir entry base dest
  notes_dir="$(notes_dir_of "$config")"
  [ -n "$notes_dir" ] || notes_dir="$WS/notes"
  notes_repo="$(basename "$notes_dir")"
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
  local logfile
  logfile="$(snapshot_log_path)"
  mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$logfile")"
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
  <key>StandardOutPath</key><string>$logfile</string>
  <key>StandardErrorPath</key><string>$logfile</string>
</dict>
</plist>
PLIST
  launchctl unload "$plist" >/dev/null 2>&1 || true
  if launchctl load -w "$plist" 2>/dev/null; then
    log "scheduled via launchd: $plist (every 60s; logs at $logfile)"
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

RUN_VIEWER="$WS/bin/run-viewer"
# Where versions up to 0.3 put it; install removes that copy now that it lives in bin/.
LEGACY_RUN_VIEWER="$WS/run-viewer.sh"
# A line only the shipped viewer launcher carries, so install/uninstall remove the file it installed
# — from any version — and never a script of the user's own that happens to have the same name.
RUN_VIEWER_MARKER="ainotes: installed by install.sh"

# remove_run_viewer [PATH] — remove the launcher at PATH (default: both locations) if it's ours
remove_run_viewer() {
  local path
  [ $# -gt 0 ] || set -- "$RUN_VIEWER" "$LEGACY_RUN_VIEWER"
  for path in "$@"; do
    [ -f "$path" ] || continue
    if grep -qF "$RUN_VIEWER_MARKER" "$path"; then
      run rm -f "$path"
      [ "$DRY_RUN" = 1 ] || log "removed $path"
    else
      log "left $path in place (not the one this script installs)"
    fi
  done
  if [ -d "$WS/bin" ] && [ -z "$(ls -A "$WS/bin")" ]; then run rmdir "$WS/bin"; fi
}

is_maintainer_tool() {
  local name
  for name in "${MAINTAINER_TOOLS[@]}"; do [ "$1" = "$name" ] && return 0; done
  return 1
}

remove_stale_maintainer_tools() {
  local name
  for name in "${MAINTAINER_TOOLS[@]}"; do
    if [ -e "$DEST/tools/$name" ]; then
      run rm -f "$DEST/tools/$name"
      [ "$DRY_RUN" = 1 ] || log "removed $DEST/tools/$name (not part of a workspace install)"
    fi
  done
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
    "SessionStart": [
        ("startup", cmd("session-start-task-prompt.sh")),
        ("startup", cmd("detect-unregistered-repo.sh")),
        ("startup", cmd("detect-notes-repo-change.sh")),
    ],
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
  remove_stale_maintainer_tools
  remove_run_viewer
  run rm -rf "$DEST/templates/notes-repo"
  for d in tools templates agents hooks skills; do [ -d "$DEST/$d" ] && run rmdir "$DEST/$d" 2>/dev/null || true; done
  [ -f "$SETTINGS" ] && edit_settings remove
  log "uninstalled from $WS (your notes repo and its .config.yml were left untouched)"
  exit 0
fi

migrate_config
migrate_dm_pr_review
migrate_notes_repo
prepare_notes_repo

for s in "$SRC"/skills/ainotes-*; do copy_dir "$s" "$DEST/skills/$(basename "$s")"; done
for a in "$SRC"/agents/*.md; do copy_file "$a" "$DEST/agents/$(basename "$a")"; done
for h in "${HOOK_SCRIPTS[@]}"; do copy_file "$SRC/hooks/scripts/$h" "$DEST/hooks/$h"; done
for t in "$SRC"/tools/*; do
  is_maintainer_tool "$(basename "$t")" && continue
  copy_file "$t" "$DEST/tools/$(basename "$t")"
done
remove_stale_maintainer_tools
copy_dir "$SRC/templates/notes-repo" "$DEST/templates/notes-repo"
# When this script runs from the npm package (`npx ainotes-viewer install`), the template's
# .gitignore arrives as "gitignore" — npm drops dotted .gitignore files from tarballs — so put the
# dot back. A no-op for an install from a clone, where the file already has its real name.
if [ -f "$DEST/templates/notes-repo/gitignore" ] && [ ! -e "$DEST/templates/notes-repo/.gitignore" ]; then
  run mv "$DEST/templates/notes-repo/gitignore" "$DEST/templates/notes-repo/.gitignore"
fi
copy_file "$SRC/templates/workspace/run-viewer" "$RUN_VIEWER"
remove_run_viewer "$LEGACY_RUN_VIEWER"
edit_settings add
maybe_schedule_snapshot_agents

cat <<EOF

Done. Next steps:
  1. cd "$WS" && claude
  2. Say "setup ainotes" — it creates your notes repo and its .config.yml (skip if you already have one).
  3. Open the viewer any time with bin/run-viewer from the workspace root.
EOF
