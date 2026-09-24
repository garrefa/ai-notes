---
name: ainotes-tasks
description: >-
  Track open work as tasks in the notes repo (`notes_repo` in .ai-notes/config.yml) — a master ledger (<notes_repo>/db/TASKS.md, open vs. completed, same "see it like open PRs" pattern as ainotes-pr-tracker) plus one detail file per task (<notes_repo>/db/tasks/YYYY-MM-DD-slug.md) with an optional deadline and a workflow status taken from the configurable `task_statuses` list (default backlog / in-progress / done / dropped). A SessionStart hook nudges Claude to ask, near the top of a session, whether to track that session's purpose as a task; when a task is active for a session and a Jira ticket or PR gets created, this skill updates the task with it. Trigger on "new task: ...", "add a task ...", "track this as a task", "what are my open tasks", "show tasks", "start task <x>", "move task <x> to <status>", "drop task <x>", "mark task <x> done", "complete task <x>", or a bare "<x> is done" when <x> isn't on today's daily plan (ainotes-daily-plan takes it if it is; ask if ambiguous).
---

# Task Tracker (ainotes-tasks)

Companion to `ainotes-pr-tracker` and `ainotes-daily-plan`: one durable ledger of open/completed tasks across
this workspace, so "what am I working on / what did I say I'd do" doesn't require re-deriving it from
memory or scrollback. Unlike `ainotes-daily-plan` (one calendar day, manually checked off, no cross-linking),
a task here can span multiple sessions and days, moves through a configurable set of statuses, and
accumulates the Jira ticket(s) and PR(s) it produces as they appear.

This skill owns `<notes_repo>/db/TASKS.md` and `<notes_repo>/db/tasks/*.md` — `ainotes-notes` doesn't touch them.

(`<notes_repo>` below means the `notes_repo` value from the workspace's `.ai-notes/config.yml` — see
`ainotes-notes` for the config-discovery rule and the canonical `db/` layout, including what to do
with a legacy repo that has no `db/`. Jira links are built from `jira.base_url`; if the config
has no `jira` block, the `Jira` column and `jira:` field simply stay `—`/`[]` and Jira linking is skipped.)

## Statuses

Statuses come from `task_statuses` in `.ai-notes/config.yml` — an ordered list of
`{ key, label, closed? }`. If the key is absent, use exactly these defaults:

```yaml
task_statuses:
  - { key: backlog,     label: Backlog }
  - { key: in-progress, label: In progress }
  - { key: done,        label: Done,        closed: true }
  - { key: dropped,     label: Dropped,     closed: true }
```

- The **key** is the only thing ever written to a task file's `status:` and to `TASKS.md`'s `Status`
  cell. `label` is for display (friendlier wording in chat and reports). Status colors aren't part of
  the config; they're a viewer-only setting (the viewer's Settings).
- A status is **closed** when it has `closed: true` (finished — the task lives in the Completed table);
  every other status is **non-closed** (still in play — the Open table).
- If the configured list lacks at least one closed and one non-closed status, don't guess: tell the
  user the config is invalid and suggest fixing it with `ainotes-setup`.
- **Default status for a new task**: the first status in the list. Exception: if the user is starting
  on the task right now (e.g. it was created via the SessionStart nudge for this session's own work, or
  they say they're starting it) and there's a non-closed status other than the first, use the
  **second non-closed status** instead (with the defaults: `in-progress` rather than `backlog`).
- **Status is not a tag.** Never put a status key in `tags:` (or in `INDEX.md` as a tag section); the
  `status:` field is the single source of truth.
- **Legacy `status: open`** (tasks written before configurable statuses): treat it as the first
  non-closed status, and legacy `status: done` as `done` if that key exists (otherwise the first closed
  status). When you come across one, offer once to normalize it — rewriting the frontmatter and the
  `TASKS.md` row to the new format in a single commit — and never rewrite without a yes.

## Files

```
<notes_repo>/db/TASKS.md                   # ledger: Open + Completed tables, same convention as PRS.md
<notes_repo>/db/tasks/YYYY-MM-DD-slug.md   # one file per task
```

### `db/TASKS.md`

A single living document, not dated. The `File` column links are relative to `db/` (where `TASKS.md`
itself lives), i.e. `tasks/YYYY-MM-DD-slug.md` — never `db/tasks/...`.
Edit only the affected rows — never regenerate the whole file.
If it doesn't exist yet, create it with these two empty sections before the first row is appended.

```markdown
# Task Tracker

## Open
| Task | Status | Created | Deadline | Jira | PRs | File |
|---|---|---|---|---|---|---|
| Add rate limiting to gateway | in-progress | 2026-09-10 | — | [PROJ-123](https://acme.atlassian.net/browse/PROJ-123) | [#12](https://github.com/acme/api-gateway/pull/12) | [tasks/2026-09-10-gateway-rate-limiting.md](tasks/2026-09-10-gateway-rate-limiting.md) |

## Completed
| Task | Status | Created | Completed | Deadline | Jira | PRs | File |
|---|---|---|---|---|---|---|---|
```

**Open** holds every task in a non-closed status; **Completed** holds every task in a closed status
(so a `dropped` task sits in Completed with `Status` = `dropped`). The `Status` cell is always the
status key. `Deadline` is `—` when none was given. `Jira`/`PRs` cells hold `—` until one exists, then a
comma-separated list of links (never a bare key/number).

**Legacy ledger**: if `TASKS.md` still has the old headers (no `Status` column), offer to migrate it —
insert the `Status` column into both tables, filling it from each task file's `status:` (legacy
`open`/`done` mapped as in **Statuses**). Don't add rows in the new shape to an old-shape table.

### `<notes_repo>/db/tasks/YYYY-MM-DD-slug.md`

```markdown
---
title: <short task title, verbatim or lightly cleaned up>
created: YYYY-MM-DD
deadline: YYYY-MM-DD | null
status: backlog   # one of the task_statuses keys (see Statuses); never repeated in tags
domain: []        # ainotes-notes taxonomy, best-effort
jira: []          # e.g. ["PROJ-123"]
prs: []           # e.g. ["acme/api-gateway#12"]
tags: [task]
links: []         # related notes/plans discovered along the way, relative to db/ (e.g. "notes/...md")
---

## Purpose
<what this task is trying to accomplish, and any context on why it exists>

## Updates
- YYYY-MM-DD: <event — created (backlog) / linked Jira PROJ-123 / opened PR #12 / status backlog -> in-progress / etc.>
```

## Creating a task

Trigger phrases: `new task: ...`, `add a task ...`, `track this as a task`, or the user saying yes to
the SessionStart nudge (below).

1. Take the task title from the user's own words (trim, don't invent scope beyond what they said). Ask
   for a deadline only if it's natural in the moment — don't force it; `null`/`—` is a fine default.
2. Pick the initial status per the default rule in **Statuses** (first status; second non-closed status
   when the user is starting on it right now). If the user names a status, use that instead.
3. Create `<notes_repo>/db/tasks/YYYY-MM-DD-slug.md` with the frontmatter above and a `## Purpose` section
   describing the task in the user's terms.
4. Append a row to the table matching that status (normally **Open**).
5. Append the path (relative to `db/`, e.g. `tasks/YYYY-MM-DD-slug.md`) under a `## task` tag section
   in `db/INDEX.md` (plus any domain tags that clearly
   apply, reusing the `ainotes-notes` taxonomy — never a status).
6. Commit on `main`:
   `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Add task: <title>"`.
7. Confirm back to the user in chat (title, status, file path, deadline if any).

## SessionStart nudge

The toolkit provides a `SessionStart` hook (`hooks/scripts/session-start-task-prompt.sh`, wired via
`hooks/hooks.json` when installed as a plugin, or via the workspace's `.claude/settings.json` when
installed with `install.sh`). It discovers the workspace root by walking up for `.ai-notes/` and, when
found, injects a reminder at the start of every session in this workspace: near the top of the
conversation, ask the user whether they want to track that session's purpose as a task. Skip the ask
when the session is obviously a trivial one-off question, or when another task-tracking skill already
covers the session's purpose (`ainotes-task` records its own plan note; `ainotes-daily-plan` already has
the item on today's list). If the user says yes, run the "Creating a task" flow above — the user is
starting on it now, so it gets the second non-closed status when one exists — and treat that task as
**active for the rest of this session** (see below).

## Keeping an active task updated with Jira/PRs

While a task is active for the current session (created via the nudge above, or the user explicitly
says "this is for task X"):

- The moment a Jira ticket gets created in this session (via `ainotes-task`, a Jira integration, or ad
  hoc), add its key to the task file's `jira:` frontmatter list and a line under `## Updates`, and
  refresh the `Jira` cell in the task's `TASKS.md` row — as a link, never a bare key. (Only applies when
  the config has a `jira` block.)
- The moment a PR gets opened in this session (via `gh pr create`, `ainotes-task`, or ad hoc), add it to the
  task file's `prs:` list and `## Updates`, and refresh the `PRs` cell in `TASKS.md`. This is in
  addition to — not instead of — `ainotes-pr-tracker` registering the PR in `PRS.md`; the two ledgers track
  different things (PR lifecycle vs. task ownership) and both get updated.
- Linking a Jira ticket or PR never changes the task's status by itself.
- Do this before reporting the created Jira ticket/PR back to the user, not as an afterthought.
- Commit each update: `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Update task: <title> (link <Jira key|PR>)"`.
- If no task is active for the session, don't guess — this only fires for a task you know is the one
  in scope.

## "what are my open tasks" / "show tasks"

Read `TASKS.md`'s **Open** table and report it grouped by status, in `task_statuses` order (e.g.
In progress, then Backlog — or config order; use each status's `label` as the group heading and skip
empty groups). For each task: title, deadline (flag anything overdue or due soon), and whether it has
Jira/PRs linked yet. Legacy rows/files with `status: open` go in the first non-closed status's group.
If the Open table is empty, say so plainly.

## Changing a task's status

Triggers:

- `start task <x>` → the second non-closed status if one exists, otherwise the first non-closed status.
- `move task <x> to <status>` → that status, matched against keys and labels case-insensitively
  (if it matches none, list the configured statuses and ask).
- `drop task <x>` → `dropped` if that key exists; otherwise ask which closed status to use.
- `mark task <x> done` / `complete task <x>` / a bare `<task> is done` (see below) → `done` if that key
  exists; otherwise the first closed status.

Purely reactive, same as `ainotes-daily-plan` — never infer a status change from a merged PR, a closed
Jira ticket, or activity in the session on your own initiative; if something suggests a task moved
on, ask rather than assume.

**Bare `"<x> is done"`** (no "task" keyword) is shared with `ainotes-daily-plan`: prefer today's daily plan
(`<notes_repo>/db/daily/YYYY-MM-DD.md`) if the item is on it; otherwise mark it done in `TASKS.md`'s Open
table; if it plausibly matches both, or neither clearly, ask the user which one they mean. Explicit
`mark task <x> done` / `complete task <x>` always go to `TASKS.md` (`ainotes-tasks`).

1. Match `<x>` to the closest row in `TASKS.md` (Open first; Completed too when the target status is
   non-closed, i.e. reopening); if ambiguous, ask which one. If it's already in the target status, say
   so and stop.
2. Set the task file's `status:` to the new key and add an `## Updates` line
   (`YYYY-MM-DD: status <old> -> <new>`, plus any reason the user gave).
3. Update the `TASKS.md` row:
   - non-closed → non-closed: change the `Status` cell in place.
   - non-closed → closed: move the row to **Completed**, setting `Status` and `Completed` to today.
   - closed → closed (e.g. `done` → `dropped`): change the `Status` cell in place; keep the `Completed` date.
   - closed → non-closed (reopened): move the row back to **Open**, dropping the `Completed` date.
4. Commit: `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "<verb> task: <title>"` —
   `Complete` for `done`, `Drop` for `dropped`, `Reopen` for closed → non-closed, otherwise
   `Move task: <title> (<old> -> <new>)`.

## Deadlines

Purely informational — nothing runs on a timer to check them. When reporting open tasks, flag any
whose `deadline` has passed or is within a few days, but never nag proactively outside of a task-list
request. Deadlines on tasks in a closed status are never flagged.
