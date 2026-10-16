# Changelog

All notable changes to ainotes — the Claude Code plugin (`.claude-plugin/`, `skills/`, `agents/`,
`hooks/`, `tools/`) and the viewer (`webapp/`) — are documented here. Both halves of the toolkit
share one version number, bumped together by `tools/release.sh`; see the "Releasing" section of the
[README](README.md#releasing) for how a release is cut.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

New entries don't go in this file: each PR adds a fragment in [`changes/`](changes/README.md),
which `tools/release.sh` folds into the release's section here.

## [Unreleased]

## [0.4.0] - 2026-10-16

- `ax-babysit-prs`: per-PR state file `<notes repo>/.state/babysit/<owner>-<repo>-<n>.json` keeps
  timers and once-per-head rules (deploy comment sha, review request thread, reminders, bot
  re-requests, `known_blocker`, which replaces `rerun_already`) across passes and sessions.
- `pr-poller` also returns each bot reviewer's latest review with its actionable review-body items
  (nitpicks, outside-diff notes), the head SHA, labels, review decision and, with `ci.gate_check`,
  the gate's unmet requirements ("needs 1 more review" instead of "CI failing").
- New optional config, all off by default: `review.bots`, `review.bot_rerequest`,
  `review.ready_label`, `merge.manual_repos`, `merge.queue_file`, `ci.gate_check`,
  `ci.deploy_policy`, `ci.deploy_excluded_repos`, `ci.deployed_label`, `ci.no_services_check`,
  `ci.lock_label`, `ci.holder_label`, `ci.lock_notice_template`, `reminders` (office hours),
  `on_merge`, `review_request.style`. Details in `skills/ax-babysit-prs/policies.md` and
  `tools/config.example.yml`.
- `ax-pr-review-request`: reads an optional `<notes repo>/github-slack-people.yml` first for Slack
  mentions (template in `templates/`), supports a one-line `short` style and records the posted
  message `ts` in the babysit state file.
- `ax-babysit-prs` lists `supersedes` bot PRs as "can now be closed" and stops or stretches its
  wakeup to office hours when only human-only blockers remain.
- Fix: `tools/check-prs.sh` no longer overwrites rows the ledger-keeper added to `PRS.md` while it
  was running (a lost update: six freshly registered PRs vanished from the ledger). Both now take
  a shared lock, the new `tools/ledger-lock.sh` (an atomic `mkdir <notes repo>/.ledger.lock`, stale
  after 10 minutes or when its owner is gone), around their ledger write and commit. `check-prs.sh`
  hashes `PRS.md` when it starts, re-checks under the lock, and redoes its run from the fresh file
  (3 attempts, then fails without writing) if it changed. `.ledger.lock/` joins the notes repo's
  gitignore rules (install adds it to existing notes repos).
- `check-prs.sh` also tracks open PRs assigned to you (`--assignee @me`), not just those you
  authored.
- New `tools/notes.sh` (also `npx ainotes-viewer notes ...`): a command line for the notes repo. The
  repo is the folder named by the `AINOTES_DIR` environment variable, so it works from any
  directory and in scripts.
  - `list`, `search` and `show` cover every file in the notes repo (notes, plans, daily, reviews,
    tasks, the support KB, the root ledgers), not only `notes/` and `plans/`. `list` filters by
    `--kind` (folder or `root`), `--type note|plan`, `--tag`, `--repo` and `--name`.
  - `search PATTERN` looks inside file contents (fixed text, case-insensitive; `--regex`, `--case`,
    `--files` to list matching files only) with the same filters, and prints `path:line:text`.
  - A file's title is its `# ` heading, else its first heading of any level, else its filename, so
    no row is blank. Only markdown files are read for headings.
  - `create`, `update` and `delete` handle `notes/*.md` and `plans/*.md` and follow the `ax-notes`
    rules: dated filename, frontmatter, `# title` line, at least one tag, an `INDEX.md` entry under
    each tag, and a plan's body stays immutable. Other folders and the ledgers are read-only here.
  - Each write commits only the files it touched and never pushes; `--no-commit` leaves it to you.
    `delete` needs `--yes`.
  - `--json` on `list`, `search` and `show`.
  - Writes also take `--jira`, `--worktree`, `--add-link` and `--message`, and a `commit` command makes
    one commit out of several `--no-commit` writes (an outcome note plus the plan's status flip).
- `ax-notes` and the `notetaker` agent now write through `notes.sh` instead of creating files, editing
  `INDEX.md` and running `git add -A` by hand. The agent's contract with `ax-task`, `ax-report` and
  the other callers is unchanged. Looking up related notes uses `notes.sh list`/`search` instead of
  grepping the folders.
- Agents: the six bookkeeping/polling agents (`notetaker`, `ledger-keeper`, `daily-plan-tracker`,
  `notes-extractor`, `pr-poller`, `review-inbox-poller`) pin `model: claude-haiku-5-5` instead of
  the floating `haiku` alias. The skills' general-purpose fallbacks still pass `model: haiku` (the
  Agent tool only accepts aliases) and now say it means Haiku 5.5.
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
- New `ax-review-notes` skill and `tools/review-note.sh`: files a finished PR review as
  `<notes_repo>/reviews/<first-date>-<repo>-<n>.md`, one note per PR. The note holds the verdict,
  summary, key changes, risk, size/CI, findings, the full comments as posted, and private
  follow-ups. A re-review appends a section and a review-history row. New notes are indexed in
  `INDEX.md` under `pr-review`, the repo, its domains and Jira keys, and only the note and
  `INDEX.md` are committed. AI-free and JSON-in, so session reviews and headless review scripts
  share one writer.
- New `ax-pr-review` skill, `tools/check-pending-pr-reviews` and `tools/pr-review.sh`:
  - `check-pending-pr-reviews` lists the PRs requesting your review directly, leaving out dependabot,
    stale and already-approved ones, least recently updated first. It uses only `gh`.
  - With `--review`, it runs a headless `/code-review` (default `high` on Opus) on each one in a
    private checkout, then approves on zero findings or leaves inline comments. PRs already
    reviewed at their current commit are skipped, and Claude only starts when something is
    pending.
  - A monthly USD cap is enforced through `--max-budget-usd`, there is a per-review cost and token
    ledger, and every review is filed via `review-note.sh`.
  - Settings are a `pr_review:` section of the ainotes config, and every key has a default.
    The spend ledger is tracked at `<notes repo>/pr-reviews-ledger.jsonl`, and local state (clone
    cache, logs) lives in the gitignored `<notes repo>/.state/pr-review/`.
- Notes-repo template documents the new `reviews/` folder.
- The ainotes config moves from `<workspace>/.ai-notes/config.yml` to `<notes repo>/.config.yml`,
  marked by `kind: ainotes-config`. Tools find it by walking up and checking each directory and its
  immediate subfolders. The folder holding it is the notes repo, so the `notes_repo` key is gone
  and renaming the notes folder needs no config edit. The rename detector's tracker moves to
  `<notes repo>/.state/last-notes-repo`. Runtime files that used to sit in `.ai-notes/`
  (`default-branches.txt`, the snapshot log) move to `<notes repo>/.state/`, which is gitignored.
  `install.sh` migrates existing workspaces on install or update:
  - it moves the config and the runtime files, then removes the empty `.ai-notes/`;
  - it adds the `.state/` ignore rule.

  A legacy `.ai-notes/config.yml` is still read until it has been migrated.
- The viewer launcher moves from `<workspace>/run-viewer.sh` to `<workspace>/bin/run-viewer`, with
  no extension. Install removes the old copy it installed, and leaves a `run-viewer.sh` of your
  own alone. Uninstall removes either one, and `bin/` if that leaves it empty.
- Scheduled jobs: new `tools/schedule.sh` and `ax-schedules` skill. You pick which tools run
  unattended (`snapshot-agents`, `check-prs`, `pr-review` = `check-pending-pr-reviews --review`,
  `clean-worktrees` = `clean-merged-worktrees.sh --delete`), how often (1m to 24h), and optionally
  an hours window and weekdays only. The choices are a `schedules:` section of the ainotes config,
  one line per job (`pr-review: every 30m 09:00-18:00 weekdays`), and become per-user launchd jobs
  on macOS or crontab lines elsewhere.
  - Each run checks the window when it fires, holds a lock so it never overlaps itself, and logs
    to `<notes repo>/.state/schedules/<job>.log` with its last exit status in `<job>.last`.
  - `install.sh` asks about every job on install, and on update shows the current schedules and
    offers to change them. Without a terminal it only re-applies them; `--no-schedule` leaves
    launchd/cron alone; `--uninstall` removes every job of the workspace. "setup ainotes" offers
    them once the config exists, and "configure schedules" changes them any time.
  - The snapshot job an earlier install set up keeps its launchd label and is adopted as
    `snapshot-agents: every 1m`; the installer's old one-off snapshot question is gone.
- Scheduled jobs now start through your login shell (`$SHELL -l`), so tokens and `PATH` set in
  shell profiles reach them. Before, a `GH_TOKEN` exported in `~/.zshenv` was missing under
  launchd, and `check-prs` and `pr-review` stopped with "gh is not authenticated".
- Skill text no longer writes amounts as `$0`/`$1`: Claude Code replaces those with skill
  arguments, so the loaded `ax-schedules` and `ax-pr-review` skills showed the wrong
  words (e.g. "configure" as a cost).
- Viewer: a **PR Reviews** view (glasses icon, right after Pull requests in the Library) lists the
  notes repo's `reviews/` folder, where `ax-review-notes` files one note per reviewed PR. A
  review is titled by its `# Review: repo#123 · …` heading, shows its latest verdict (Approved /
  Commented / Changes requested) as its status, is dated by its latest review so re-reviews come
  back up the list, and its excerpt is the review summary. Like the other note views it's hidden
  while empty and follows the tag and date filters.
- Viewer: a Library item added in a new version slots in after the item it follows by default,
  instead of at the bottom of a Library order you've customized.
- Viewer: HTML comments (such as a review's `<!-- review-history:end -->` marker) are no longer shown
  as text in a rendered note, and table rows and comments are never used as a note's excerpt.

## [0.3.0] - 2026-10-01

- Viewer: a folder no longer shows as "can't be read" or "couldn't be found" while an agent or git
  is writing to it. A reload retries `NotReadableError`/`NotFoundError` a few times before giving up,
  ignores file changes under `.git/`, and when a reload does fail it keeps watching the folder, so it
  reconnects on its own at the next change on disk instead of waiting for a Retry click.
- New `detect-notes-repo-change.sh` SessionStart hook: when `notes_repo` in `.ai-notes/config.yml`
  changes (a renamed or moved notes repo), it alerts you to update launchd agents and cron jobs that
  still point at the old folder, listing each one. It repeats each session until none does.
  `ainotes-setup` runs the same check whenever it changes `notes_repo` itself, and recommends running
  the tools from the workspace root with no notes-repo path, since they read `notes_repo` from the
  config on every run.
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
- Changelog entries are now one fragment file per PR in `changes/` instead of edits to
  `CHANGELOG.md`, so PRs open at the same time no longer conflict on it. `tools/release.sh` folds
  the fragments into the release's section and deletes them; see `changes/README.md`.
- Viewer: the New dialog has a content box, so a note, plan, daily plan or task can be written
  before it's created: it goes under a note's or plan's title, becomes a daily plan's list, or a
  task's Purpose. With content the new file opens to read; left empty, it opens in the editor with
  the usual starter body as before. While the box holds text, Esc or a click outside doesn't close
  the dialog, and ⌘/Ctrl+Enter creates from inside it.
- Viewer: richer note rendering. `:shortcode:` emoji become emoji, inline code shows as a code pill
  instead of with literal backticks, fenced code with a language is syntax-highlighted (light and
  dark), and GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) render
  as callouts. Web links open in a new tab.
- Viewer: a link from one note to another — a relative `.md` link or a `[[wiki]]` link naming a note
  by file name, with or without its date — opens that note in a popover over the current one. Links
  inside it open the next note in place (Back returns), Maximize fills the window, and Open makes it
  the main note. A `[[wiki]]` link that names no note shows as plain text.
- Viewer: a note's action row (Edit, Delete, Favorite, Add task, Maximize) stays pinned to the top
  of the note pane while the note scrolls, instead of scrolling away with it.

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

[Unreleased]: https://github.com/garrefa/ai-notes/compare/v0.4.0...HEAD
[0.1.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.1.0
[0.2.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.2.0
[0.3.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.3.0
[0.4.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.4.0
