# notes

Second brain for this workspace. Lives inside the workspace (as the `notes_repo` directory named in
`.ai-notes/config.yml`) and is where every note and plan for any of its repos gets stored. All data
lives under [`db/`](db/); this README, `CLAUDE.md`, and `.gitignore` stay at the root:

```
db/
├── notes/  plans/  tasks/  daily/
├── INDEX.md
├── PRS.md
└── TASKS.md
```

- `Add a note ...` / `note: ...` → `db/notes/YYYY-MM-DD-slug.md`
- `Add a plan ...` / `plan: ...` (or a plan approved via the `ainotes-task` skill) → `db/plans/YYYY-MM-DD-slug.md`

Every file carries dated, tagged frontmatter (including a `domain` taxonomy from config and, where
relevant, an `epic`/`jira` key), cross-referenced through [`db/INDEX.md`](db/INDEX.md). See the
`ainotes-notes` Claude Code skill for the full format.

Other ledgers kept here:

- [`db/PRS.md`](db/PRS.md) — every PR opened across the workspace's repos and its merge/close status
  (maintained by `ainotes-pr-tracker`).
- [`db/TASKS.md`](db/TASKS.md) — open vs. completed tasks with a per-task status (configurable via `task_statuses` in `.ai-notes/config.yml`), one detail file per task under `db/tasks/`
  (maintained by `ainotes-tasks`).
- `db/daily/YYYY-MM-DD.md` — manually-checked daily plans (maintained by `ainotes-daily-plan`).

This repo is git-tracked for history, but it's a simple one: no worktrees, no per-note branches, no
ticket of its own — that process is for the actual code repos in the workspace. Commits land
directly on `main`. Links inside the ledgers and `db/INDEX.md` are relative to `db/`
(`notes/...md`, `tasks/...md`).

## Refreshing db/PRS.md without AI

The toolkit ships `tools/check-prs.sh`, which does the mechanical part of the `ainotes-pr-tracker`
skill's "check prs" — reconcile, deep-status refresh, commit — as a standalone script (`gh` + `jq`,
no LLM). It lives with the toolkit (not in this repo); by default it finds this repo's `db/PRS.md` via
`.ai-notes/config.yml`:

```
check-prs.sh                 # refresh db/PRS.md in place, commit if anything changed
check-prs.sh --dry-run        # show what would change, don't write or commit
check-prs.sh --verbose        # log progress + print the diff
check-prs.sh path/to/PRS.md   # point it at a different file
```

Schedule it yourself (cron, launchd, CI) at whatever cadence you want — it's idempotent and a
true no-op run touches nothing.
