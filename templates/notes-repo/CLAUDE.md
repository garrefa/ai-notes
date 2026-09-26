# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This is the second brain for the surrounding workspace. It holds every note and plan for any of that
workspace's repos, organized as dated, tagged Markdown files — see the `ainotes-notes` skill for the
full format (frontmatter schema, domain taxonomy, filenames, `INDEX.md`). Workspace-level settings
(domain taxonomy, Jira project, GitHub org) live in `../.ai-notes/config.yml`, not here.

There is no build/lint/test tooling here — it's plain Markdown content, not code.

## Layout

```
README.md  CLAUDE.md  .gitignore   # repo docs stay at the root
notes/YYYY-MM-DD-slug.md
plans/YYYY-MM-DD-slug.md
tasks/YYYY-MM-DD-slug.md
daily/YYYY-MM-DD.md
INDEX.md    # tag -> files map
PRS.md      # PR ledger (ainotes-pr-tracker)
TASKS.md    # task ledger (ainotes-tasks)
```

Links inside `INDEX.md`, the ledgers, and frontmatter `links:` are relative to this repo's root (e.g.
`notes/2026-09-03-slug.md`, `tasks/2026-09-10-slug.md`). Git commands run at this repo's root.

## Workflow

- Triggers: `Add a note ...` / `note: ...` and `Add a plan ...` / `plan: ...` (see the `ainotes-notes`
  skill), or a plan gets written here automatically once approved via the `ainotes-task` skill.
- Simple git history: commits land directly on `main` — no worktrees, no per-note branches, no PR flow.
  That process belongs to the actual code repos elsewhere in the workspace; this repo just records that
  it happened.
- A plan's body is immutable once written. When it's later executed (via `ainotes-task`), the outcome is
  recorded as a **new** note that links back, and only the plan's `status` frontmatter field is flipped
  — its body is never rewritten with results.
- `PRS.md`, `TASKS.md`, and `INDEX.md` are edited in place — touch only the affected rows/sections,
  never regenerate them from scratch.
