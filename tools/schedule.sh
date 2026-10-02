#!/usr/bin/env bash
#
# schedule.sh — run the ainotes tools on a schedule: per-user launchd jobs on macOS, crontab lines
# elsewhere. Which tools run, how often and during which hours is the `schedules:` section of the
# ainotes config (<notes repo>/.config.yml), one line per job:
#
#   schedules:
#     snapshot-agents: every 1m
#     check-prs: every 30m
#     pr-review: every 30m 09:00-18:00 weekdays
#     clean-worktrees: off
#
# A spec is `off` or `every <N>m|<N>h [HH:MM-HH:MM] [weekdays]`. The interval goes into the job
# itself; the hours window and the weekdays rule are checked by `schedule.sh run` each time the job
# fires, so a run outside them exits at once without doing anything. Each job holds a lock while
# it runs, so a slow run (a PR review takes minutes) is never started twice.
#
# Usage:
#   schedule.sh [--workspace DIR] [--dry-run] list
#   schedule.sh [--workspace DIR] [--dry-run] set JOB SPEC   # save JOB's spec, then apply
#   schedule.sh [--workspace DIR] [--dry-run] configure      # interactive: ask about every job
#   schedule.sh [--workspace DIR] [--dry-run] apply          # make launchd/cron match the config
#   schedule.sh [--workspace DIR] [--dry-run] remove-all     # unschedule every job (uninstall)
#   schedule.sh [--workspace DIR] run JOB                    # what the scheduled job runs
#
#   --workspace DIR   the ainotes workspace (default: found by walking up from the current
#                     directory, then this script's own, until <notes repo>/.config.yml turns up)
#   --dry-run         print what would change; write nothing
#
# Jobs run the installed tools in <workspace>/.claude/tools/, from the workspace root, with the
# PATH in effect when they were applied (launchd and cron start with a minimal one). Output goes to
# <notes repo>/.state/schedules/<job>.log, and the last run's time and exit status to <job>.last.
# Re-applying replaces this workspace's own jobs and never touches anyone else's.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ainotes-config.sh
source "$SCRIPT_DIR/ainotes-config.sh"

# The schedulable jobs: name|command (in .claude/tools/, plus arguments)|suggested spec|what it does
JOBS=(
  "snapshot-agents|snapshot-agents.sh|every 1m|Feeds the viewer's Agents view (AGENTS.json). No LLM, \$0."
  "check-prs|check-prs.sh|every 30m|Reconciles PRS.md with GitHub and commits it. No LLM, \$0."
  "pr-review|check-pending-pr-reviews --review|every 30m 09:00-18:00 weekdays|Headless Claude review of each PR requesting your review. \$0 when none are pending; each review costs money, capped by pr_review's budgets."
  "clean-worktrees|clean-merged-worktrees.sh --delete|every 24h|Removes worktrees whose branch is merged and whose tree is clean. No LLM, \$0."
)
CONFIG_SECTION="schedules"
CONFIG_HEADER="# Scheduled jobs (ainotes-schedules): \`off\` or \`every <N>m|<N>h [HH:MM-HH:MM] [weekdays]\`. Change with \"configure schedules\" or .claude/tools/schedule.sh configure."
LOG_MAX_LINES=2000

WORKSPACE="" DRY_RUN=0

die() { echo "schedule.sh: $*" >&2; exit 1; }
log() { echo "ainotes: $*"; }

# ---------------------------------------------------------------------------------------------------
# Catalog and specs
# ---------------------------------------------------------------------------------------------------

job_names() { local j; for j in "${JOBS[@]}"; do echo "${j%%|*}"; done; }
job_list() { job_names | paste -sd' ' -; }

# job_field JOB N — field N (2 command, 3 suggested spec, 4 description) of JOB's catalog entry
job_field() {
  local j
  for j in "${JOBS[@]}"; do
    [[ "${j%%|*}" == "$1" ]] && { echo "$j" | cut -d'|' -f"$2"; return 0; }
  done
  return 1
}

is_job() { job_field "$1" 1 >/dev/null; }

# parse_spec SPEC — validate SPEC and set SPEC_OFF, SPEC_SECONDS, SPEC_FROM/SPEC_TO (minutes since
# midnight, empty for all day) and SPEC_WEEKDAYS (0/1). Prints the reason and fails when invalid.
parse_spec() {
  local spec="$1" word n unit from to words=()
  SPEC_OFF=0 SPEC_SECONDS="" SPEC_FROM="" SPEC_TO="" SPEC_WEEKDAYS=0
  read -r -a words <<<"$spec"
  set -- "${words[@]}"
  if [[ $# -eq 1 && "$1" == off ]]; then SPEC_OFF=1; return 0; fi
  [[ "${1:-}" == every ]] || { echo "expected \`off\` or \`every <N>m|<N>h ...\`, got \"$spec\""; return 1; }
  shift
  if [[ "${1:-}" =~ ^([0-9]+)([mh])$ ]]; then
    n=$((10#${BASH_REMATCH[1]})) unit="${BASH_REMATCH[2]}"
  else
    echo "bad interval \"${1:-}\" — use minutes or hours, like 5m or 2h"; return 1
  fi
  if [[ "$unit" == m ]]; then SPEC_SECONDS=$((n * 60)); else SPEC_SECONDS=$((n * 3600)); fi
  ((SPEC_SECONDS >= 60 && SPEC_SECONDS <= 86400)) || { echo "the interval must be between 1m and 24h"; return 1; }
  shift
  for word in "$@"; do
    if [[ "$word" =~ ^([0-9]{1,2}):([0-9]{2})-([0-9]{1,2}):([0-9]{2})$ ]]; then
      from=$((10#${BASH_REMATCH[1]} * 60 + 10#${BASH_REMATCH[2]}))
      to=$((10#${BASH_REMATCH[3]} * 60 + 10#${BASH_REMATCH[4]}))
      ((from < to && to <= 1440)) || { echo "bad hours \"$word\" — the start must come before the end, within one day"; return 1; }
      SPEC_FROM=$from SPEC_TO=$to
    elif [[ "$word" == weekdays ]]; then
      SPEC_WEEKDAYS=1
    else
      echo "unexpected \"$word\" — after the interval only HH:MM-HH:MM and weekdays are allowed"; return 1
    fi
  done
}

# spec_interval / spec_hours — the parts of the last parsed spec, as written in a spec
spec_interval() {
  if ((SPEC_SECONDS % 3600 == 0)); then echo "$((SPEC_SECONDS / 3600))h"; else echo "$((SPEC_SECONDS / 60))m"; fi
}
spec_hours() {
  [[ -n "$SPEC_FROM" ]] && printf '%02d:%02d-%02d:%02d' $((SPEC_FROM / 60)) $((SPEC_FROM % 60)) $((SPEC_TO / 60)) $((SPEC_TO % 60))
  return 0
}

# normalize_spec SPEC — SPEC rewritten in its canonical form (fails on an invalid spec)
normalize_spec() {
  parse_spec "$1" >&2 || return 1
  if ((SPEC_OFF)); then echo off; return 0; fi
  local out="every $(spec_interval)" hours
  hours="$(spec_hours)"
  [[ -n "$hours" ]] && out+=" $hours"
  ((SPEC_WEEKDAYS)) && out+=" weekdays"
  echo "$out"
}

# in_window — true if now falls inside the last parsed spec's hours and days
in_window() {
  local now
  if ((SPEC_WEEKDAYS)) && (($(date +%u) > 5)); then return 1; fi
  [[ -z "$SPEC_FROM" ]] && return 0
  now=$((10#$(date +%H) * 60 + 10#$(date +%M)))
  ((now >= SPEC_FROM && now < SPEC_TO))
}

# ---------------------------------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------------------------------

load_workspace() {
  if [[ -n "$WORKSPACE" ]]; then
    [[ -d "$WORKSPACE" ]] || die "not a directory: $WORKSPACE"
    WORKSPACE="$(cd "$WORKSPACE" && pwd)"
    CONFIG="$(find_ainotes_config "$WORKSPACE" || true)"
    [[ -n "$CONFIG" && "$(workspace_root_of "$CONFIG")" == "$WORKSPACE" ]] || CONFIG=""
  else
    CONFIG="$(find_ainotes_config "$PWD" || find_ainotes_config "$SCRIPT_DIR" || true)"
    [[ -n "$CONFIG" ]] || die "no ainotes config found — run \"setup ainotes\" first, or pass --workspace"
    WORKSPACE="$(workspace_root_of "$CONFIG")"
  fi
  [[ -n "$CONFIG" ]] && config_is_legacy "$CONFIG" && CONFIG=""
  WS_ID="$(workspace_id "$WORKSPACE")"
  TOOLS_DIR="$WORKSPACE/.claude/tools"
  if [[ -n "$CONFIG" ]]; then STATE="$(state_dir_of "$CONFIG")/schedules"; else STATE=""; fi
}

require_config() {
  [[ -n "$CONFIG" ]] || die "no <notes repo>/.config.yml for $WORKSPACE — run \"setup ainotes\" first"
}

has_schedules_section() { [[ -n "$CONFIG" ]] && grep -qE "^$CONFIG_SECTION:" "$CONFIG"; }

# saved_spec JOB — JOB's spec from the config, canonical; `off` when absent or invalid. Before the
# config has a schedules: section, a snapshot job left by an older install counts as `every 1m`.
saved_spec() {
  local raw
  if [[ "$1" == snapshot-agents ]] && ! has_schedules_section && legacy_snapshot_job_exists; then
    echo "every 1m"; return 0
  fi
  raw="$(config_value "$CONFIG" "$CONFIG_SECTION" "$1")"
  [[ -n "$raw" ]] && normalize_spec "$raw" 2>/dev/null || echo off
}

# write_schedules JOB=SPEC... — rewrite the config's schedules: section with every catalog job,
# taking the given specs and keeping the saved ones for the rest. The section moves to the end of
# the file; everything else in it is left as it was.
write_schedules() {
  local job spec pair rest tmp
  tmp="$CONFIG.tmp"
  {
    # everything but the old section and its header, without trailing blank lines
    awk -v section="$CONFIG_SECTION" -v header="$CONFIG_HEADER" '
      $0 == header { next }
      $0 ~ ("^" section ":") { skipping = 1; next }
      skipping && /^[^ \t]/ { skipping = 0 }
      skipping { next }
      /^[ \t]*$/ { blanks = blanks $0 "\n"; next }
      { printf "%s%s\n", blanks, $0; blanks = "" }
    ' "$CONFIG"
    printf '\n%s\n%s:\n' "$CONFIG_HEADER" "$CONFIG_SECTION"
    while IFS= read -r job; do
      spec=""
      for pair in "$@"; do [[ "${pair%%=*}" == "$job" ]] && spec="${pair#*=}"; done
      [[ -n "$spec" ]] || spec="$(saved_spec "$job")"
      printf '  %s: %s\n' "$job" "$spec"
    done < <(job_names)
  } > "$tmp"
  if ((DRY_RUN)); then
    echo "would: rewrite the $CONFIG_SECTION: section of $CONFIG as:"
    sed -n "/^$CONFIG_SECTION:/,\$p" "$tmp" | sed 's/^/    /'
    rm -f "$tmp"
  else
    mv "$tmp" "$CONFIG"
  fi
  rest=""; for pair in "$@"; do rest+=" ${pair%%=*}"; done
  ((DRY_RUN)) || log "saved schedules in $CONFIG${rest:+ (changed:$rest)}"
}

# ---------------------------------------------------------------------------------------------------
# Backends: launchd (macOS) and cron (everything else)
# ---------------------------------------------------------------------------------------------------

is_macos() { [[ "$(uname -s)" == Darwin ]]; }
launchd_label() { echo "com.ainotes.$1.$WS_ID"; }
launchd_plist() { echo "$HOME/Library/LaunchAgents/$(launchd_label "$1").plist"; }
cron_marker() { echo "# ainotes-schedule:$WS_ID:$1 ($WORKSPACE)"; }
# What install.sh up to 0.3 wrote for the snapshot job's crontab line
legacy_cron_marker() { echo "# ainotes-snapshot-agents:$WS_ID"; }
job_log() { echo "$STATE/$1.log"; }

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

render_plist() {
  local job="$1" seconds="$2"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(launchd_label "$job")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$TOOLS_DIR/schedule.sh")</string>
    <string>--workspace</string>
    <string>$(xml_escape "$WORKSPACE")</string>
    <string>run</string>
    <string>$job</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$WORKSPACE")</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(xml_escape "$PATH")</string></dict>
  <key>StartInterval</key><integer>$seconds</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$(job_log "$job")")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$(job_log "$job")")</string>
</dict>
</plist>
PLIST
}

launchd_loaded() { launchctl list "$(launchd_label "$1")" >/dev/null 2>&1; }

launchd_install() {
  local job="$1" seconds="$2" plist new
  plist="$(launchd_plist "$job")"
  new="$(render_plist "$job" "$seconds")"
  if [[ -f "$plist" && "$(cat "$plist")" == "$new" ]] && launchd_loaded "$job"; then return 0; fi
  if ((DRY_RUN)); then echo "would: write $plist and load it (every $seconds s)"; return 0; fi
  mkdir -p "$(dirname "$plist")" "$STATE"
  printf '%s\n' "$new" > "$plist"
  launchctl unload "$plist" >/dev/null 2>&1 || true
  if launchctl load -w "$plist" 2>/dev/null; then
    log "scheduled $job via launchd ($plist)"
  else
    echo "ainotes: wrote $plist but 'launchctl load' failed — load it yourself: launchctl load -w \"$plist\"" >&2
  fi
}

launchd_remove() {
  local plist
  plist="$(launchd_plist "$1")"
  [[ -f "$plist" ]] || return 0
  if ((DRY_RUN)); then echo "would: unload and delete $plist"; return 0; fi
  launchctl unload "$plist" >/dev/null 2>&1 || true
  rm -f "$plist"
  log "unscheduled $1 (removed $plist)"
}

# cron_timing SECONDS — the crontab time fields for an interval (cron can only repeat evenly
# within an hour or a day, so other intervals are refused)
cron_timing() {
  local s="$1" m h
  if ((s % 3600 == 0)); then
    h=$((s / 3600))
    if ((h == 24)); then echo "0 0 * * *"; elif ((24 % h == 0)); then echo "0 */$h * * *"; else return 1; fi
  else
    m=$((s / 60))
    ((s % 60 == 0 && m < 60 && 60 % m == 0)) || return 1
    if ((m == 1)); then echo "* * * * *"; else echo "*/$m * * * *"; fi
  fi
}

crontab_without() {  # crontab_without MARKER... — the current crontab minus lines carrying any MARKER
  local current marker
  current="$(crontab -l 2>/dev/null || true)"
  for marker in "$@"; do current="$(grep -vF -- "$marker" <<<"$current" || true)"; done
  [[ -n "$current" ]] && printf '%s\n' "$current"
  return 0
}

cron_install() {
  local job="$1" seconds="$2" timing line
  command -v crontab >/dev/null 2>&1 || { echo "ainotes: no crontab command — schedule $job yourself" >&2; return 0; }
  timing="$(cron_timing "$seconds")" || { echo "ainotes: cron can't repeat every $seconds s evenly — pick an interval that divides an hour or a day" >&2; return 0; }
  line="$timing cd '$WORKSPACE' && PATH='$PATH' '$TOOLS_DIR/schedule.sh' --workspace '$WORKSPACE' run $job >> '$(job_log "$job")' 2>&1 $(cron_marker "$job")"
  crontab -l 2>/dev/null | grep -qxF -- "$line" && return 0
  if ((DRY_RUN)); then echo "would: add a crontab line for $job ($timing)"; return 0; fi
  mkdir -p "$STATE"
  { crontab_without "$(cron_marker "$job")"; printf '%s\n' "$line"; } | crontab -
  log "scheduled $job via cron ($timing)"
}

cron_remove() {
  local marker="$1" label="$2"
  command -v crontab >/dev/null 2>&1 || return 0
  crontab -l 2>/dev/null | grep -qF -- "$marker" || return 0
  if ((DRY_RUN)); then echo "would: remove the crontab line for $label"; return 0; fi
  crontab_without "$marker" | crontab -
  log "unscheduled $label (crontab)"
}

schedule_job() { if is_macos; then launchd_install "$@"; else cron_install "$@"; fi; }
unschedule_job() { if is_macos; then launchd_remove "$1"; else cron_remove "$(cron_marker "$1")" "$1"; fi; }

is_scheduled() {
  if is_macos; then [[ -f "$(launchd_plist "$1")" ]] && launchd_loaded "$1"
  else crontab -l 2>/dev/null | grep -qF -- "$(cron_marker "$1")"; fi
}

# A snapshot job set up by an install.sh that predates schedules: (launchd label unchanged, or the
# old crontab marker). If the config has no schedules: section yet, it's adopted as `every 1m`.
legacy_snapshot_job_exists() {
  if is_macos; then [[ -f "$(launchd_plist snapshot-agents)" ]]
  else crontab -l 2>/dev/null | grep -qF -- "$(legacy_cron_marker)"; fi
}

adopt_legacy_snapshot_job() {
  has_schedules_section && return 0
  legacy_snapshot_job_exists || return 0
  log "adopting the snapshot-agents job an earlier install set up (every 1m)"
  write_schedules "snapshot-agents=every 1m"
}

# ---------------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------------

cmd_apply() {
  local job spec
  require_config
  adopt_legacy_snapshot_job
  is_macos || cron_remove "$(legacy_cron_marker)" "the old snapshot-agents line"
  while IFS= read -r job; do
    spec="$(saved_spec "$job")"
    parse_spec "$spec" >/dev/null
    if ((SPEC_OFF)); then unschedule_job "$job"; else schedule_job "$job" "$SPEC_SECONDS"; fi
  done < <(job_names)
}

cmd_set() {
  local job="${1:-}" spec="${2:-}" canonical
  [[ -n "$job" && -n "$spec" ]] || die "usage: schedule.sh set JOB SPEC (jobs: $(job_list))"
  is_job "$job" || die "unknown job \"$job\" (jobs: $(job_list))"
  require_config
  canonical="$(normalize_spec "$spec" 2>&1)" || die "$job: $canonical"
  adopt_legacy_snapshot_job
  write_schedules "$job=$canonical"
  if ((DRY_RUN)); then
    parse_spec "$canonical" >/dev/null
    if ((SPEC_OFF)); then unschedule_job "$job"; else schedule_job "$job" "$SPEC_SECONDS"; fi
  else
    cmd_apply
  fi
}

# last_run JOB — "YYYY-MM-DD HH:MM exit N" from the job's .last file, or "never"
last_run() {
  local f="$STATE/$1.last"
  if [[ -n "$STATE" && -f "$f" ]]; then cat "$f"; else echo never; fi
}

cmd_list() {
  local job spec state
  printf '%-16s %-34s %-11s %s\n' JOB SCHEDULE STATE "LAST RUN"
  while IFS= read -r job; do
    if [[ -n "$CONFIG" ]]; then spec="$(saved_spec "$job")"; else spec="off (no config)"; fi
    if is_scheduled "$job"; then state=scheduled; elif [[ "$spec" == off* ]]; then state=-; else state="NOT LOADED"; fi
    printf '%-16s %-34s %-11s %s\n' "$job" "$spec" "$state" "$(last_run "$job")"
    printf '  %s\n' "$(job_field "$job" 4)"
  done < <(job_names)
  [[ -n "$CONFIG" ]] && echo && echo "Config: $CONFIG ($CONFIG_SECTION:)   Logs: $STATE/"
  return 0
}

# ask PROMPT DEFAULT — read a line from the terminal, DEFAULT on an empty answer
ask() {
  local reply
  read -r -p "  $1 [$2] " reply || reply=""
  echo "${reply:-$2}"
}

yes_no() { case "$1" in y|Y|yes|Yes|YES) return 0 ;; *) return 1 ;; esac; }

# ask_spec JOB — interactively build JOB's spec, starting from its saved (or suggested) one
ask_spec() {
  local job="$1" saved base on every hours weekdays spec err
  saved="$(saved_spec "$job")"
  if [[ "$saved" == off ]]; then base="$(job_field "$job" 3)"; on=n; else base="$saved"; on=y; fi
  echo >&2
  echo "$job — $(job_field "$job" 4)" >&2
  echo "  now: $saved" >&2
  if ! yes_no "$(ask "Schedule it? (y/n)" "$on")"; then echo off; return 0; fi
  parse_spec "$base" >/dev/null
  every="$(spec_interval)" hours="$(spec_hours)" weekdays=n
  ((SPEC_WEEKDAYS)) && weekdays=y
  while true; do
    every="$(ask "How often? (like 5m, 30m, 2h)" "$every")"
    hours="$(ask "Only between these hours? (HH:MM-HH:MM, or \"all\" for all day)" "${hours:-all}")"
    [[ "$hours" == all ]] && hours=""
    weekdays="$(ask "Weekdays only? (y/n)" "$weekdays")"
    spec="every $every${hours:+ $hours}"
    yes_no "$weekdays" && spec+=" weekdays"
    if err="$(normalize_spec "$spec" 2>&1)"; then echo "$err"; return 0; fi
    echo "  $err — try again" >&2
    parse_spec "$base" >/dev/null
    hours="$(spec_hours)"
  done
}

cmd_configure() {
  local job spec pairs=()
  require_config
  [[ -t 0 ]] || die "configure needs a terminal; use \"schedule.sh set JOB SPEC\" instead"
  echo "Scheduled ainotes jobs for $WORKSPACE (Enter keeps the value in brackets):"
  # a for loop, not `read` from job_names: the prompts read stdin
  for job in $(job_names); do
    spec="$(ask_spec "$job")"
    pairs+=("$job=$spec")
  done
  echo
  write_schedules "${pairs[@]}"
  if ((DRY_RUN)); then return 0; fi
  cmd_apply
  echo
  cmd_list
}

cmd_remove_all() {
  local plist job
  if is_macos; then
    for plist in "$HOME/Library/LaunchAgents"/com.ainotes.*."$WS_ID".plist; do
      [[ -f "$plist" ]] || continue
      job="$(basename "$plist" ".$WS_ID.plist")"; job="${job#com.ainotes.}"
      launchd_remove "$job"
    done
  else
    cron_remove "# ainotes-schedule:$WS_ID:" "every job of this workspace"
    cron_remove "$(legacy_cron_marker)" "the old snapshot-agents line"
  fi
}

# cmd_run JOB — the scheduled entry point: honor the saved spec's hours and days, hold a lock so
# runs never overlap, run the tool from the workspace root, and record the outcome in <job>.last.
cmd_run() {
  local job="${1:-}" log_file started rc=0 cmd
  is_job "$job" || die "unknown job \"$job\""
  require_config
  parse_spec "$(saved_spec "$job")" >/dev/null
  ((SPEC_OFF)) && return 0
  in_window || return 0

  mkdir -p "$STATE"
  RUN_LOCK="$STATE/$job.lock"
  if ! mkdir "$RUN_LOCK" 2>/dev/null; then
    if kill -0 "$(cat "$RUN_LOCK/pid" 2>/dev/null || echo 0)" 2>/dev/null; then return 0; fi
    rm -rf "$RUN_LOCK"; mkdir "$RUN_LOCK" || return 0
  fi
  echo $$ > "$RUN_LOCK/pid"
  trap 'rm -rf "$RUN_LOCK"' EXIT

  log_file="$(job_log "$job")"
  if [[ -f "$log_file" ]] && (($(wc -l < "$log_file") > LOG_MAX_LINES)); then
    tail -n $((LOG_MAX_LINES / 2)) "$log_file" > "$log_file.tmp" && cat "$log_file.tmp" > "$log_file" && rm -f "$log_file.tmp"
  fi

  read -r -a cmd <<<"$(job_field "$job" 2)"
  started="$(date '+%Y-%m-%d %H:%M')"
  cd "$WORKSPACE"
  "$TOOLS_DIR/${cmd[0]}" "${cmd[@]:1}" || rc=$?
  echo "$started exit $rc" > "$STATE/$job.last"
  ((rc == 0)) || echo "[$started] $job exited $rc" >&2
  return 0
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace) WORKSPACE="${2:-}"; shift ;;
      --dry-run) DRY_RUN=1 ;;
      -h|--help) sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      -*) die "unknown option: $1" ;;
      *) break ;;
    esac
    shift
  done
  local command="${1:-list}"
  [[ $# -gt 0 ]] && shift
  load_workspace
  case "$command" in
    list|status) cmd_list ;;
    set) cmd_set "$@" ;;
    configure) cmd_configure ;;
    apply) cmd_apply ;;
    remove-all) cmd_remove_all ;;
    run) cmd_run "$@" ;;
    *) die "unknown command \"$command\" — see --help" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
