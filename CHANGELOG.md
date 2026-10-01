# Changelog

All notable changes to ainotes — the Claude Code plugin (`.claude-plugin/`, `skills/`, `agents/`,
`hooks/`, `tools/`) and the viewer (`webapp/`) — are documented here. Both halves of the toolkit
share one version number, bumped together by `tools/release.sh`; see the "Releasing" section of the
[README](README.md#releasing) for how a release is cut.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

- Viewer: the note list and the note detail scroll independently. The page itself is one window
  tall and no longer scrolls as a whole.
- Viewer: the version reads "AINotes v0.2.0 (123)" in both the sidebar and Settings, with the build
  number in parentheses: the commit count of the build. The release workflow now checks out full
  history so that count is right.

- Viewer: a **Maximize** button on every note hides the sidebar and the note list so the note fills
  the window. Press it again, or Esc, to go back: the sidebar returns only if it was open before.
- Viewer: a note's details fill the whole detail pane instead of a fixed 42rem column, so they
  widen with the window or a maximized note.
- Viewer: the note list can be dragged narrower, down to 18rem, from its 28rem default, which is
  also its widest; the width is remembered per browser.
- Viewer: the open note no longer sticks around when it stops matching the list. Changing the
  view, tag, date range or task-status filter, or editing the note's own tags or status so it no
  longer fits, deselects it and opens the list's first note instead; it isn't reselected if the
  filter later lets it back in. Changing a filter with unsaved edits asks first, as switching notes
  does. Opening a specific note (search, a task link, a note just created) loosens whichever filter
  would hide it.
- Viewer: **Favorites** is third in the default Library order, right after Pull requests.
- Viewer: favorites are the `fav` tag in each note's frontmatter instead of a list in the
  browser's localStorage, so they're committed with the notes repo and the same everywhere. The
  heart adds or removes the tag. Favorites saved by an earlier version are moved into tags the
  first time the folder opens.
- Viewer: **Add task** on every note, plan, daily plan, PR and agent creates a task that points
  back to it, in the `ainotes-tasks` format. From a note: its path in `links:` and a line under
  `## Purpose`, with the note's tags as the task's starting tags. From a PR: it goes in `prs:` and
  TASKS.md's PRs cell, and the task appears under the PR's linked tasks, with its title, state and
  Jira under `## Purpose`. From an agent: its job, repo, worktree, state and last status under
  `## Purpose`, and any PRs it links to in `prs:`.

- Viewer: Settings shows the viewer version more prominently, bottom right above the Reset/Done
  buttons. What "closed" means moved from the dialog's description to an info icon next to each
  Closed switch, shown on hover. The per-status reset button is gone; **Reset all to defaults**
  remains.

## [0.2.0] - 2026-09-30

- New `ainotes-review-inbox` skill: finds every open PR org-wide (not just repos in the workspace)
  where your review is requested, and reports each one summarized, flagged stale, and prioritized
  (high/medium/low). Data gathering (`tools/review-inbox.sh`) is a plain shell script — one `gh
  search prs` call plus a handful of batched GraphQL lookups, no LLM — and only the two genuinely
  fuzzy calls (summarizing a PR, picking its priority) go to the new `review-inbox-poller` agent,
  which runs on Haiku.
- Viewer: create notes, plans, daily plans and tasks from a **New** dialog, in the skills' own
  format (frontmatter, file name, `INDEX.md` entry, and a `TASKS.md` row for a task); delete them
  (their `INDEX.md` entries and `TASKS.md` row go too); change a task's deadline in place, with its
  `TASKS.md` row kept in step.
- Viewer: unsaved edits are protected. Leaving a note mid-edit asks Save / Discard / Keep editing,
  closing the tab gets the browser's warning, and an edit left behind that way is offered back the
  next time the note opens.
- Viewer: favorites. A heart on any note, plan, daily plan or task marks it (stored per folder in
  the browser) and lists it under a new **Favorites** Library item.
- Viewer: every note shows its path, starting with the connected folder's name (e.g.
  `_notes/notes/…`), with a copy button.
- Viewer: a note whose title is its `# heading` no longer shows the title twice (above the note and
  at the top of the rendered body); tasks, titled in frontmatter, keep it above. The note's date and type
  sit on the left of its button row, with its tags on the line below.
- `ainotes-notes` / `notetaker`: every note and plan body starts with a `# <title>` line. Plans used
  to be saved with the Plan subagent's text as-is, which starts at `## …`, so they had no title
  (the viewer fell back to the file path).
- Viewer: the Library now opens with **Agents** and **Pull requests** first, and hides items with
  nothing in them (Agents and Pull requests always show). The date range no longer applies to
  Tasks, Favorites, Pull requests or Agents.
- Viewer: working agents show a spinner on their status chip.
- Viewer: in a flat-layout folder (none of the expected `notes/`/`plans/` subdirectories), a note
  shows its path instead of the date/type/repo line, and new tags can't be added (existing ones can
  still be removed), since there's no frontmatter convention for them to live in.
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

[Unreleased]: https://github.com/garrefa/ai-notes/compare/v0.2.0...HEAD
[0.1.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.1.0
[0.2.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.2.0
