---
name: ainotes-daily-plan
description: >-
  Track a running, manually-checked daily task list in the notes repo (`notes_repo` in .ai-notes/config.yml). Given a list of tasks (e.g. "Friday plan: ..." or "daily plan: ..."), enriches each one with relevant context via the read-only daily-plan-tracker subagent (past notes-repo history + current live state — never touches code or PRs), then writes <notes_repo>/db/daily/YYYY-MM-DD.md as a checklist. Throughout the day, when the user says a task is done, marks it done in place — purely reactive, no automated completion detection. On request, reports what's open vs done. Trigger on "<Weekday> plan:", "daily plan:", "today's plan:", "plan for today", "mark <task> done", "<task> is done" (when the item is on today's plan — explicit "mark task <x> done" / "complete task <x>" belong to ainotes-tasks), "what's left today/on my plan", "check my daily plan".
---

# Daily Plan (ainotes-daily-plan)

A lightweight, manual, git-backed checklist for one calendar day's tasks in the
current workspace. This skill never executes the tasks themselves,
never decides on its own that something is done, and never runs on a timer or hook. It only:
(1) writes down what the user says to track, enriched with context, and (2) marks an item
done when the user says so — nothing more automated than that.

For actually doing the engineering work behind a task, use `ainotes-task`. For the notes-repo
mechanics this skill builds on, see `ainotes-notes` — this is a thin, specialized layer over the
same store, with its own file convention (below) rather than the `db/notes/`/`db/plans/` split.

(`<notes_repo>` below means the `notes_repo` value from the workspace's `.ai-notes/config.yml` —
see `ainotes-notes` for the config-discovery rule and the canonical `db/` layout, including what to
do with a legacy repo that has no `db/`.)

## Who writes the file

Writes to `db/daily/` and its `INDEX.md` entries go through the `ledger-keeper` agent. Spawn the
`ledger-keeper` agent (named `ainotes:ledger-keeper` when AINotes is installed as a plugin). If
neither name is available, spawn a general-purpose agent with `model: haiku` and give it the contents
of `<skill base dir>/../../agents/ledger-keeper.md` as its instructions. Always pass
`notes_repo_path` and `toolkit_dir` (`<skill base dir>/../..`) along with the operation's fields.
Showing the checklist, matching the user's words to an item, and asking which item they meant all
stay in the main thread; don't re-read the file the agent wrote.

## Trigger phrases

- **Start of day**: `"<Weekday> plan: ..."`, `"daily plan: ..."`, `"today's plan: ..."`,
  `"plan for today: ..."` followed by a list of tasks (numbered or bulleted).
- **During the day**: `"mark <task> as done"`, `"<task> is done"`, `"I finished <task>"`,
  `"check my daily plan"`, `"what's left today"`, `"what's left on my plan"`.

## Layout

```
<notes_repo>/db/daily/YYYY-MM-DD.md   # one file per calendar day
<notes_repo>/db/INDEX.md              # gets a `daily-plan` tag section, same append-only convention
                                      # (entries relative to db/, e.g. `daily/YYYY-MM-DD.md`)
```

## Frontmatter

```yaml
---
date: YYYY-MM-DD
type: daily-plan
domain: []      # union of domains touched by the day's tasks, from the ainotes-notes taxonomy
epic: null
tags: [daily-plan]
status: open    # open -> done once every item is checked, or the user says stop tracking for the day
links: []       # notes/plans/PRs discovered while enriching tasks (note/plan paths relative to db/)
---
```

## Creating today's plan

1. Take the user's tasks verbatim as checklist items — don't reword, reorder, or merge them.
2. For each task, launch the **`daily-plan-tracker`** subagent (named
   `ainotes:daily-plan-tracker` when AINotes is installed as a plugin; if neither name is available,
   spawn a general-purpose agent with `model: haiku` and give it the contents of
   `<skill base dir>/../../agents/daily-plan-tracker.md` as its instructions) to enrich it with context — related notes-repo history and current live state (PR/CI/review
   status, relevant flags, etc.). Launch these in parallel across tasks; the agent is read-only
   and cheap (haiku), and it never edits, commits, merges, or otherwise acts on anything — it only
   researches and reports back. Never substitute a general-purpose or code-editing agent for this
   step, and never do the enrichment lookups yourself in a way that could tempt you into also
   acting on what you find (e.g. merging a PR while "just checking" its status) — that boundary is
   the whole reason this step is delegated to an agent that structurally can't.
3. Fold each task's findings into:
   ```markdown
   - [ ] <task, verbatim>
     - Context: <what the tracker found, with links/PR numbers/filenames so it's checkable later>
   ```
   If the tracker found nothing relevant, write `Context: no related history or notable live
   state found` — say so plainly rather than omitting the line or inventing filler.
4. Hand the items to `ledger-keeper` as `daily_write {date, items: [{text, context}], domain?, links?}`
   (`domain` = the day's domains, reusing the `ainotes-notes` taxonomy). It writes
   `<notes_repo>/db/daily/YYYY-MM-DD.md` with the frontmatter above (creating `db/daily/` if needed),
   appends `daily/YYYY-MM-DD.md` under `## daily-plan` (and those domain tags) in `db/INDEX.md`, and
   commits on `main` (`"Add daily plan: YYYY-MM-DD"`), returning `{path, sha}`.
5. Show the resulting checklist back to the user in chat — from the items you already have, not by
   re-reading the file.
6. If today's file already exists (a second invocation the same day), the same `daily_write`
   **appends** the new tasks rather than overwriting or recreating the file.

## Marking tasks done

- Purely reactive to the user's own words, at any point during the day. Never infer completion
  from an external signal on your own initiative (a merged PR, green CI, a shipped note) — if
  something you happen to see suggests a task is done, ask the user rather than assuming or
  auto-marking it.
- Match the user's statement to the closest existing checklist line; if more than one plausibly
  matches, ask which one rather than guessing. Flip it to `- [x]`, and if the user gave any detail
  worth keeping, add or update a one-line `Done: ...` note under it.
- **A single mark-done stays inline** — it's a one-line edit, cheaper than spawning an agent: flip the
  line (and set `status: done` if it was the last open item), then
  `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Update daily plan: YYYY-MM-DD (mark '<task>' done)"`.
  Marking several items at once goes to `ledger-keeper` in one call: one
  `daily_mark {date, item, done, detail?}` per item, with the exact checklist text you matched as `item`.
- **Bare `"<x> is done"`** (no "task" keyword) is shared with `ainotes-tasks`: prefer today's daily plan
  (`<notes_repo>/db/daily/YYYY-MM-DD.md`) if the item is on it; otherwise hand it to `ainotes-tasks`,
  which moves the matching `db/TASKS.md` Open row to its done status; if it plausibly matches both, or
  neither clearly, ask the user which one they mean. Explicit `mark task <x> done` / `complete task <x>`
  (and any other task status change — `start task`, `move task … to …`, `drop task`) always go to
  `ainotes-tasks`. Checking an item off here never changes a task's status.
- No hooks, no polling, no scheduled re-checks, no `/loop` — this skill never marks something
  done by itself, ever. That's the whole point: it's the user's own tracking.

## Reporting status

- Read today's file and report open vs. done items directly from it — trust the file as the
  source of truth, don't re-derive status from GitHub/CI/anywhere else.
- If asked to refresh context on a still-open item, re-launch `daily-plan-tracker` for just that
  item and hand the result to `ledger-keeper` as `daily_write` with that one item (same `text`, new
  `context`) — it replaces the existing `Context:` bullet and commits.

## End of day

- Unchecked items are left exactly as-is; there is no auto-carry-forward into tomorrow's file.
  Whether an open item reappears in the next day's plan is that day's invocation to decide (the
  user restates it) — this skill never infers or copies items forward on its own.
