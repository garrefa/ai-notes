- Scheduled jobs now start through your login shell (`$SHELL -l`), so tokens and `PATH` set in
  shell profiles reach them. Before, a `GH_TOKEN` exported in `~/.zshenv` was missing under
  launchd, and `check-prs` and `pr-review` stopped with "gh is not authenticated".
- Skill text no longer writes amounts as `$0`/`$1`: Claude Code replaces those with skill
  arguments, so the loaded `ainotes-schedules` and `ainotes-pr-review` skills showed the wrong
  words (e.g. "configure" as a cost).
