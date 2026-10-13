- **Breaking:** every skill is renamed from `ainotes-<name>` to `ax-<name>` (`ainotes-notes` ->
  `ax-notes`, `ainotes-task` -> `ax-task`, `ainotes-tasks` -> `ax-tasks`, `ainotes-pr-review` ->
  `ax-pr-review`, and likewise `babysit-prs`, `daily-plan`, `pr-review-request`, `pr-tracker`,
  `report`, `review-inbox`, `review-notes`, `schedules` and `setup`). Anything that invokes a skill
  by name must change, e.g. `/ainotes-notes` -> `/ax-notes`. The plugin (`ainotes`, so agents stay
  `ainotes:<agent>`), the `ainotes-viewer` command, `tools/ainotes-config.sh`, the `com.ainotes.*`
  launchd labels and the notes repo's `kind: ainotes-config` marker keep their names. This is a
  breaking change, so the next release should bump the minor version (0.x semver).
- `install.sh`: installing (and `--uninstall`) also removes the pre-rename `ainotes-<name>` copy of
  each of these skills from `<ws>/.claude/skills/`, so a workspace doesn't end up with both names.
  It only removes a directory whose `SKILL.md` declares `name: ainotes-<name>` (one this toolkit
  installed) and logs each removal; a skill of your own that shares a name is left in place.
