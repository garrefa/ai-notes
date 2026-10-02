---
name: ainotes-schedules
description: Choose which ainotes tools run on a schedule, how often, and in which hours — the agents snapshot for the viewer, the PRS.md refresh, automated PR reviews and merged-worktree cleanup. Settings are the `schedules:` section of `<notes repo>/.config.yml`, one line per job (`off` or `every <N>m|<N>h [HH:MM-HH:MM] [weekdays]`); `tools/schedule.sh` turns them into per-user launchd jobs (macOS) or crontab lines. install.sh asks the same questions on install and update; this skill changes them any time. Trigger on "configure schedules", "what's scheduled", "schedule <job> every …", "only run reviews during working hours", "stop the <job> schedule", "why didn't <job> run".
---

# Scheduled jobs (ainotes-schedules)

Some ainotes tools are meant to run unattended. Which ones run, how often and when is one line per
job in the `schedules:` section of the ainotes config (`<notes repo>/.config.yml`):

```yaml
schedules:
  snapshot-agents: every 1m
  check-prs: every 30m
  pr-review: every 30m 09:00-18:00 weekdays
  clean-worktrees: off
```

| Job | Runs | Suggested | Cost |
|---|---|---|---|
| `snapshot-agents` | `snapshot-agents.sh` — writes `AGENTS.json` for the viewer's Agents view | `every 1m` | free |
| `check-prs` | `check-prs.sh` — reconciles `PRS.md` with GitHub and commits it | `every 30m` | free |
| `pr-review` | `check-pending-pr-reviews --review` — headless review of each PR requesting you (ainotes-pr-review) | `every 30m 09:00-18:00 weekdays` | free when nothing is pending; reviews cost money, capped by `pr_review:` budgets |
| `clean-worktrees` | `clean-merged-worktrees.sh --delete` — removes worktrees whose branch is merged and tree is clean | `every 24h` | free |

A spec is `off`, or `every <N>m` / `every <N>h` (1m to 24h), optionally followed by an hours window
`HH:MM-HH:MM` (same day, start before end) and `weekdays` (Monday to Friday). The interval is
built into the launchd/cron job; the window and weekdays are checked each time the job fires, so a
run outside them exits immediately. A job never overlaps itself (a lock is held while it runs).

`tools/schedule.sh` is the only thing that writes the section or touches launchd/cron. Never edit
plists or the crontab by hand for these jobs, and never hand-edit the section without running
`apply` afterwards.

## Operations

`S=<workspace>/.claude/tools/schedule.sh` (run from anywhere in the workspace).

| Ask | Do |
|---|---|
| "what's scheduled" / "schedule status" | `$S list`: each job's spec, whether launchd/cron has it loaded, and its last run (time and exit status) |
| "schedule <job> every …" / a direct change | Translate to a spec and run `$S set <job> "<spec>"`. Show the resulting `$S list`. |
| "configure schedules" (open-ended) | The interview below, then one `$S set` per changed job |
| "stop <job>" / "unschedule <job>" | `$S set <job> off` |
| "why didn't <job> run" | `$S list` (`NOT LOADED` means the config says on but launchd/cron doesn't have it: run `$S apply`), then the tail of `<notes repo>/.state/schedules/<job>.log`, then check the spec's window and weekdays against when it was expected |
| after renaming the notes folder, or moving the workspace | `$S apply` re-renders every job with the current paths |
| preview a change | add `--dry-run` before the command: prints the new section and the launchd/cron changes, writes nothing |

`$S configure` is the same interview as an interactive terminal prompt (what install.sh runs). It
needs a TTY, so inside Claude Code use the interview below instead.

## The interview ("configure schedules")

1. Run `$S list` and show the current state in a short table.
2. Ask with `AskUserQuestion` (multiSelect) which jobs should run on a schedule, pre-describing each
   one with its cost line from the table above. Jobs left unselected become `off`.
3. For each selected job, ask in one `AskUserQuestion` round (one question per job, up to four):
   how often and when. Offer the current spec (if on) and the suggested spec as options, plus a
   working-hours variant (`… 09:00-18:00 weekdays`) where it differs; "Other" takes a free-form spec.
   Validate free-form answers by running `$S --dry-run set <job> "<spec>"`, which prints the reason
   on an invalid one; ask again on a failure.
4. For `pr-review`, remind the user each run can post reviews in their name and spend from the
   monthly `pr_review.monthly_budget_usd`, and that a 1–2 minute interval brings no benefit (the
   job is locked while a review runs; reviews take minutes).
5. Apply with `$S set <job> "<spec>"` for each job whose spec changed, then show `$S list`.

If there is no `<notes repo>/.config.yml` yet, run `ainotes-setup` first: there is nowhere to
save schedules before it exists.

## Notes

- Jobs run `<workspace>/.claude/tools/…` from the workspace root through the user's login shell
  (`$SHELL -l -c`), so tokens and `PATH` set in shell profiles (e.g. `GH_TOKEN` in `~/.zshenv`)
  reach them, as in a terminal. The `PATH` captured when they were applied is passed as well. If a tool such as `gh`, `jq` or
  `claude` moves, run `$S apply` again from a shell where it's on `PATH`.
- Logs: `<notes repo>/.state/schedules/<job>.log` (trimmed automatically) and `<job>.last`.
- Labels are `com.ainotes.<job>.<workspace id>` (launchd) or crontab lines tagged
  `# ainotes-schedule:<workspace id>:<job>`, so several workspaces never collide. A snapshot job
  set up by an older install (same label) is adopted as `snapshot-agents: every 1m`.
- Jobs the user set up by hand (any other label or crontab line) are not ainotes's. Never change or
  remove them; if one duplicates an ainotes job (e.g. a hand-made `check-prs.sh` agent), point that
  out and let the user decide.
- `install.sh --uninstall` removes every ainotes job of the workspace.
