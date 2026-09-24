---
name: ainotes-tasks
description: >-
  Track open work as tasks in the notes repo (`notes_repo` in .ai-notes/config.yml) — a master ledger (<notes_repo>/TASKS.md, open vs. completed, same "see it like open PRs" pattern as ainotes-pr-tracker) plus one detail file per task (<notes_repo>/tasks/YYYY-MM-DD-slug.md) with an optional deadline. A SessionStart hook nudges Claude to ask, near the top of a session, whether to track that session's purpose as a task; when a task is active for a session and a Jira ticket or PR gets created, this skill updates the task with it. Trigger on "new task: ...", "add a task ...", "track this as a task", "what are my open tasks", "show tasks", "mark task <x> done", "complete task <x>", or a bare "<x> is done" when <x> isn't on today's daily plan (ainotes-daily-plan takes it if it is; ask if ambiguous).
---

# Task Tracker (ainotes-tasks)

Companion to `ainotes-pr-tracker` and `ainotes-daily-plan`: one durable ledger of open/completed tasks across
this workspace, so "what am I working on / what did I say I'd do" doesn't require re-deriving it from
memory or scrollback. Unlike `ainotes-daily-plan` (one calendar day, manually checked off, no cross-linking),
a task here can span multiple sessions and days, and accumulates the Jira ticket(s) and PR(s) it
produces as they appear.

This skill owns `<notes_repo>/TASKS.md` and `<notes_repo>/tasks/*.md` — `ainotes-notes` doesn't touch them.

(`<notes_repo>` below means the `notes_repo` value from the workspace's `.ai-notes/config.yml` — see
`ainotes-notes` for the config-discovery rule. Jira links are built from `jira.base_url`; if the config
has no `jira` block, the `Jira` column and `jira:` field simply stay `—`/`[]` and Jira linking is skipped.)

## Files

```
<notes_repo>/TASKS.md          # ledger: Open + Completed tables, same convention as PRS.md
<notes_repo>/tasks/YYYY-MM-DD-slug.md   # one file per task
```

### `TASKS.md`

A single living document, not dated. Edit only the affected rows — never regenerate the whole file.
If it doesn't exist yet, create it with these two empty sections before the first row is appended.

```markdown
# Task Tracker

## Open
| Task | Created | Deadline | Jira | PRs | File |
|---|---|---|---|---|---|
| Add rate limiting to gateway | 2026-09-10 | — | [PROJ-123](https://acme.atlassian.net/browse/PROJ-123) | [#12](https://github.com/acme/api-gateway/pull/12) | [tasks/2026-09-10-gateway-rate-limiting.md](tasks/2026-09-10-gateway-rate-limiting.md) |

## Completed
| Task | Created | Completed | Deadline | Jira | PRs | File |
|---|---|---|---|---|---|---|
```

`Deadline` is `—` when none was given. `Jira`/`PRs` cells hold `—` until one exists, then a
comma-separated list of links (never a bare key/number).

### `<notes_repo>/tasks/YYYY-MM-DD-slug.md`

```markdown
---
title: <short task title, verbatim or lightly cleaned up>
created: YYYY-MM-DD
deadline: YYYY-MM-DD | null
status: open   # open -> done
domain: []     # ainotes-notes taxonomy, best-effort
jira: []       # e.g. ["PROJ-123"]
prs: []        # e.g. ["acme/api-gateway#12"]
tags: [task]
links: []      # related notes/plans discovered along the way
---

## Purpose
<what this task is trying to accomplish, and any context on why it exists>

## Updates
- YYYY-MM-DD: <event — created / linked Jira PROJ-123 / opened PR #12 / marked done / etc.>
```

## Creating a task

Trigger phrases: `new task: ...`, `add a task ...`, `track this as a task`, or the user saying yes to
the SessionStart nudge (below).

1. Take the task title from the user's own words (trim, don't invent scope beyond what they said). Ask
   for a deadline only if it's natural in the moment — don't force it; `null`/`—` is a fine default.
2. Create `<notes_repo>/tasks/YYYY-MM-DD-slug.md` with the frontmatter above and a `## Purpose` section
   describing the task in the user's terms.
3. Append a row to `TASKS.md`'s **Open** table.
4. Append the filename under a `## task` tag section in `INDEX.md` (plus any domain tags that clearly
   apply, reusing the `ainotes-notes` taxonomy).
5. Commit on `main`:
   `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Add task: <title>"`.
6. Confirm back to the user in chat (title, file path, deadline if any).

## SessionStart nudge

The toolkit provides a `SessionStart` hook (`hooks/scripts/session-start-task-prompt.sh`, wired via
`hooks/hooks.json` when installed as a plugin, or via the workspace's `.claude/settings.json` when
installed with `install.sh`). It discovers the workspace root by walking up for `.ai-notes/` and, when
found, injects a reminder at the start of every session in this workspace: near the top of the
conversation, ask the user whether they want to track that session's purpose as a task. Skip the ask
when the session is obviously a trivial one-off question, or when another task-tracking skill already
covers the session's purpose (`ainotes-task` records its own plan note; `ainotes-daily-plan` already has
the item on today's list). If the user says yes, run the "Creating a task" flow above and treat that
task as **active for the rest of this session** (see below).

## Keeping an active task updated with Jira/PRs

While a task is active for the current session (created via the nudge above, or the user explicitly
says "this is for task X"):

- The moment a Jira ticket gets created in this session (via `ainotes-task`, a Jira integration, or ad
  hoc), add its key to the task file's `jira:` frontmatter list and a line under `## Updates`, and
  refresh the `Jira` cell in `TASKS.md`'s Open row — as a link, never a bare key. (Only applies when
  the config has a `jira` block.)
- The moment a PR gets opened in this session (via `gh pr create`, `ainotes-task`, or ad hoc), add it to the
  task file's `prs:` list and `## Updates`, and refresh the `PRs` cell in `TASKS.md`. This is in
  addition to — not instead of — `ainotes-pr-tracker` registering the PR in `PRS.md`; the two ledgers track
  different things (PR lifecycle vs. task ownership) and both get updated.
- Do this before reporting the created Jira ticket/PR back to the user, not as an afterthought.
- Commit each update: `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Update task: <title> (link <Jira key|PR>)"`.
- If no task is active for the session, don't guess — this only fires for a task you know is the one
  in scope.

## "what are my open tasks" / "show tasks"

Read `TASKS.md`'s **Open** table and report it directly — title, deadline (flag anything overdue or
due soon), and whether it has Jira/PRs linked yet. If it's empty, say so plainly.

## Marking a task done

Trigger: `mark task <x> done`, `complete task <x>`, or a bare `<task> is done` (see below). Purely reactive, same as
`ainotes-daily-plan` — never infer completion from a merged PR or closed Jira ticket on your own initiative;
if something suggests a task might be done, ask rather than assume.

**Bare `"<x> is done"`** (no "task" keyword) is shared with `ainotes-daily-plan`: prefer today's daily plan
(`<notes_repo>/daily/YYYY-MM-DD.md`) if the item is on it; otherwise mark it in `TASKS.md`'s Open
table; if it plausibly matches both, or neither clearly, ask the user which one they mean. Explicit
`mark task <x> done` / `complete task <x>` always go to `TASKS.md` (`ainotes-tasks`).

1. Match to the closest row in `TASKS.md`'s Open table; if ambiguous, ask which one.
2. Move the row to **Completed**, adding today's date.
3. Flip the task file's `status: open` to `status: done` and add a closing `## Updates` line.
4. Commit: `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Complete task: <title>"`.

## Deadlines

Purely informational — nothing runs on a timer to check them. When reporting open tasks, flag any
whose `deadline` has passed or is within a few days, but never nag proactively outside of a task-list
request.
