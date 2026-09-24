---
name: ainotes-notes
description: Capture notes and plans into the workspace's notes repo, a git-backed second brain for this workspace — dated, tagged, domain-classified, cross-referenced via INDEX.md. Use when a request starts with "note:", "Add a note ...", "plan:", or "Add a plan ...". Also the skill ainotes-task delegates to for writing/updating the plan note it records for every task.
---

# Notes (notes repo)

The notes repo is the only place notes and plans go for this workspace, regardless of what repo the
conversation is otherwise touching. Its name is a config value, not a hardcoded assumption — read
`notes_repo` from `.ai-notes/config.yml` (see below for how to find that file); `<notes_repo>` below
means that value. It's a **git repo of its own** (`<notes_repo>/.git`) — separate from every code
repo — but a simple one: no worktrees, no branches per note, no Jira ticket, no review gate. That
machinery exists for the code repos because it's how the real engineering process works; the notes
repo just records that process happened, so it stays lightweight. Commit directly to its default
branch (`main`) right after writing or updating a file.

This skill owns *what* gets written, in what format, and the (simple) git commit for the notes repo.
`ainotes-task` owns the actual engineering workflow (worktrees, Plan subagent, Jira) and calls into this
skill only to persist the plan note and later update it — it never touches the notes repo's git history
itself.

Shared config lives at `.ai-notes/config.yml` at the workspace root — find it by walking up
from the current directory until a `.ai-notes/` directory turns up (same discovery pattern as `.git`;
never a path hardcoded to one specific workspace, since one ainotes-* installation can serve several
independent workspaces, each with its own `.ai-notes/`). Read it for the current `notes_repo`,
`domain_taxonomy`, `preferred_epics`, and (if present) `jira.project_key`/`jira.base_url` rather than
trusting stale copies of those values in prose anywhere, including in this file. The `jira` block is
optional — when it's absent, leave `jira: null` on every plan and never ask about tickets.

## Trigger phrases

- **Note**: request starts with `Add a note ...` or `note: ...` — a freeform note, not tied to a
  specific code task.
- **Plan**: request starts with `Add a plan ...` or `plan: ...`, or invoked internally by `ainotes-task`
  step 5 when a plan gets approved for execution in some repo.

## Layout

```
<notes_repo>/
  notes/YYYY-MM-DD-slug.md
  plans/YYYY-MM-DD-slug.md
  INDEX.md    # tag -> files map, kept up to date incrementally
```

Filenames are date-prefixed so `ls | sort` / a glob browses or range-filters by date without opening
files. The date is still duplicated into frontmatter as the canonical machine-readable field.

## Frontmatter schema

```yaml
---
date: YYYY-MM-DD
type: note | plan
repo: <repo or null>        # plans targeting a workspace repo set this; freeform notes usually null
domain: []                  # one or more tags from domain_taxonomy in .ai-notes/config.yml
epic: null                  # epic key or name, if any — always ask, don't assume none (see preferred_epics below)
tags: []                    # free-form, on top of domain/epic — required, at least one total across domain+tags
jira: null                  # plans only, once ainotes-task step 6 gets/creates a ticket (stays null without a jira config block)
worktree: null              # plans only: <repo>/.worktrees/<branch-name>
status: n/a                 # notes: n/a. plans: planned -> in-progress -> done (or in-review)
links: []                   # filenames of related notes/plans, e.g. "plans/2026-09-01-api-gateway-fix-token-expiry.md"
---
```

Every file needs at least one tag across `domain` + `tags` combined — untagged files are invisible to
`INDEX.md` and defeat cross-referencing. If nothing obvious fits, that's a sign the title needs
sharpening, not an excuse to skip tagging.

**Domain taxonomy** (pick one or more that fit the topic — this is the primary cross-reference axis
across repos and time): read `domain_taxonomy` from `.ai-notes/config.yml` for the current domain →
repos map. That file is the only source of domains — don't invent a fixed list here or carry one
over from another workspace. It's a living list, edited in place in that file the moment a note or plan genuinely
doesn't fit any existing domain — prefer reusing an existing domain over inventing a near-duplicate;
a new entry is only added when nothing already there fits.

**Standard free-form tags**: reuse these instead of inventing near-duplicates when a note fits.
`investigation` — any incident/root-cause diagnosis note, regardless of
whether the root cause was confirmed or the note ends up blocked. This keeps every investigation
greppable under one `INDEX.md` section without a separate folder.

**Cost (optional)**: if token/cost figures for the work are known, a note may end with a `## Cost`
section (tokens, tool calls, wall time; any USD figure flagged as directional) — the convention the
`notetaker` agent follows and `ainotes-report` rolls up. Skip it when there's nothing to record.

If an epic is given, also add `epic:<key>` to `tags` so notes under the same epic are greppable
together, in addition to the structured `epic:` field.

**Preferred epics**: read `preferred_epics` from `.ai-notes/config.yml` and offer it as suggestions when
asking about an epic (step 1 below) — never as a substitute for asking, and never assume "none" just
because nothing was mentioned. If the user names an epic not in that list, use what they said and add
it to `preferred_epics` once it's confirmed as real/ongoing; don't remove an entry until it's actually
closed.

## Adding a note

1. Ask about an epic if not already stated — offer `preferred_epics` from `.ai-notes/config.yml` as
   options, but accept anything the user actually says.
2. Grep `<notes_repo>/` for matching `domain`/`epic`/`repo` to find related earlier notes, and link them
   via `links: []` if relevant.
3. Write `notes/YYYY-MM-DD-slug.md` (`type: note`, `status: n/a`) with the frontmatter above + body.
4. Append the file under each of its `domain`/`tags` sections in `INDEX.md` (create the section if new
   — don't rewrite the whole file).
5. Commit directly on `main`: `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Add note: <slug>"`.

## Adding/updating a plan (including via ainotes-task)

1. Ask about an epic if not already stated, same as step 1 above.
2. Write `plans/YYYY-MM-DD-<repo>-slug.md` (`type: plan`, `status: planned`) with the approved plan as
   the body, `repo`/`worktree` filled in.
3. Append it to `INDEX.md` under its tags.
4. Commit on `main`, same as a note (`"Add plan: <slug>"`).
5. When `ainotes-task` reaches its step 6 (Jira ticket, if configured), come back here to update the
   same plan file's frontmatter only (`jira` when a ticket exists, `status: in-progress`) — commit the update
   (`"Update plan: <slug> (status -> in-progress)"`). Don't touch the plan's body.

Do not start executing a plan as part of writing it — plans are captured here, executed elsewhere via
`ainotes-task`.

## When a plan is executed (ainotes-task step 10)

The plan file's body is **immutable** once written — it should always read exactly as originally
approved, so it stays a reliable record of what was agreed. Never append results into it.

Instead, when `ainotes-task` finishes a task:

1. Write a **new** note in `notes/YYYY-MM-DD-slug.md` (`type: note`) recording what happened: repo,
   branch/worktree, Jira ticket (if any), review outcome, whether it was committed, and any follow-ups. Give it
   the same `domain`/`epic` as the plan, plus `links: ["plans/<plan-filename>"]`.
2. In the plan file, flip `status` to `done` (or `in-review`) and add the new note's filename to its
   own `links: []` — frontmatter only, body stays untouched.
3. Append the new note to `INDEX.md` under its tags; commit both changes on `main`
   (`"Complete plan: <slug>"`).

## INDEX.md format

```markdown
## <tag>
- notes/2026-09-03-worktree-notes.md
- plans/2026-09-01-api-gateway-fix-token-expiry.md
```

Edit only the affected tag sections when adding an entry; never regenerate the whole file from scratch.
