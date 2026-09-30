# Changelog

All notable changes to ainotes — the Claude Code plugin (`.claude-plugin/`, `skills/`, `agents/`,
`hooks/`, `tools/`) and the viewer (`webapp/`) — are documented here. Both halves of the toolkit
share one version number, bumped together by `tools/release.sh`; see the "Releasing" section of the
[README](README.md#releasing) for how a release is cut.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

- New `ainotes-review-inbox` skill: finds every open PR org-wide (not just repos in the workspace)
  where your review is requested, and reports each one summarized, flagged stale, and prioritized
  (high/medium/low). Data gathering (`tools/review-inbox.sh`) is a plain shell script — one `gh
  search prs` call plus a handful of batched GraphQL lookups, no LLM — and only the two genuinely
  fuzzy calls (summarizing a PR, picking its priority) go to the new `review-inbox-poller` agent,
  which runs on Haiku.
- Viewer: create notes, plans, daily plans and tasks from a **New** dialog, in the skills' own
  format (frontmatter, file name, `INDEX.md` entry, and a `TASKS.md` row for a task); delete them
  (their `INDEX.md` entries and `TASKS.md` row go too); rename any of them and change a task's
  deadline in place, with the task's `TASKS.md` row kept in step.
- Viewer: unsaved edits are protected. Leaving a note mid-edit asks Save / Discard / Keep editing,
  closing the tab gets the browser's warning, and an edit left behind that way is offered back the
  next time the note opens.
- Viewer: favorites. A heart on any note, plan, daily plan or task marks it (stored per folder in
  the browser) and lists it under a new **Favorites** Library item.
- Viewer: every note shows its path relative to the notes repo, with a copy button.
- Viewer: a note whose title is its `# heading` no longer shows the title twice (above the note and
  at the top of the rendered body); tasks, titled in frontmatter, keep it above.
- `ainotes-notes` / `notetaker`: every note and plan body starts with a `# <title>` line. Plans used
  to be saved with the Plan subagent's text as-is, which starts at `## …`, so they had no title
  (the viewer fell back to the file path).
- Viewer: the Library now opens with **Agents** and **Pull requests** first, and hides items with
  nothing in them (Agents and Pull requests always show). The date range no longer applies to
  Tasks, Favorites, Pull requests or Agents.
- Viewer: working agents show a spinner on their status chip.
- Viewer: a quoted frontmatter value followed by a `# comment` now parses correctly.
- `check-prs.sh` no longer rewrites a tracked PR outside `vcs.org` to a same-named repo under it.
  It used to keep only the repo name from each row's URL and rebuild every URL and `gh` call as
  `vcs.org/<name>`, so a `garrefa/ai-notes` PR became a `bitsoex/ai-notes` row that could never be
  looked up again and stayed Pending forever. It now keeps each row's owner; `vcs.org` rows look
  the same as before.
- `ainotes-pr-tracker` / `ledger-keeper`: PRs whose URL owner isn't `vcs.org`, or that come from a
  repo in `ignored_repos`, are no longer registered in `PRS.md`.

## [0.1.0] - 2026-09-26

Baseline release. Established the current shape of the toolkit:

- The `ainotes` Claude Code plugin — `ainotes-task`, `ainotes-notes`, `ainotes-pr-tracker`,
  `ainotes-babysit-prs`, `ainotes-report`, `ainotes-daily-plan`, `ainotes-tasks`,
  `ainotes-pr-review-request` and `ainotes-setup` skills, their supporting agents and hooks, and the
  `tools/` scripts that run without an LLM (`check-prs.sh`, `snapshot-agents.sh`,
  `clean-merged-worktrees.sh`). Installable via the Claude Code plugin marketplace or vendored with
  `install.sh`.
- The `webapp/` viewer — a local, file-system-backed app for browsing and editing notes, plans,
  tasks, PRs and agents across one or more notes repos. A folder without the notes-repo layout
  still opens: every `.md` file in it is listed as a note. The release number shows at the bottom
  of the sidebar, and open tabs are told when a newer version is deployed, by number.
- The `ainotes-viewer` npm package (`webapp/`): `npx ainotes-viewer@latest` runs the viewer with
  no clone, and it bundles the whole toolkit, so `npx ainotes-viewer install <workspace>` installs
  it too — including a `run-viewer.sh` at the workspace root and an optional launchd/cron schedule
  for `snapshot-agents.sh`. `snapshot-agents` and `check-prs` also run as subcommands. Needs
  Node.js 20.19+ or 22.12+.
- The notes repo keeps its data at the repo root; installing over an older repo that still uses a
  `db/` folder moves it up automatically.

[Unreleased]: https://github.com/garrefa/ai-notes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.1.0
