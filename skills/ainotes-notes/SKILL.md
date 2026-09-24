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

## Who writes the file

Every note/plan write, frontmatter update, `INDEX.md` append and commit goes through the `notetaker`
agent — this is mandatory, not an optimization you can skip. Spawn the `notetaker` agent (named
`ainotes:notetaker` when AINotes is installed as a plugin). If neither name is available, spawn a
general-purpose agent with `model: haiku` and give it the contents of
`<skill base dir>/../../agents/notetaker.md` as its instructions.

The main thread keeps what needs the conversation: it asks the epic question, picks domain/tags,
finds related links, and writes the body. It then passes the agent
`{type: note|plan, slug, frontmatter fields, body, notes_repo_path}` (or `{path, frontmatter fields}`
for a frontmatter-only update) and gets back `{path, index_sections, sha, flags}`. Don't re-read the
file the agent wrote; relay `path` and `sha`. If `flags` isn't empty, look at those specific points
yourself (or tell the user) before moving on. If it returns an `error`, report it verbatim.

## Trigger phrases

- **Note**: request starts with `Add a note ...` or `note: ...` — a freeform note, not tied to a
  specific code task.
- **Plan**: request starts with `Add a plan ...` or `plan: ...`, or invoked internally by `ainotes-task`
  step 5 when a plan gets approved for execution in some repo.

## Layout

```
<notes_repo>/
  README.md  CLAUDE.md  .gitignore   # repo docs stay at the root
  db/                                # all data lives under db/
    notes/YYYY-MM-DD-slug.md
    plans/YYYY-MM-DD-slug.md
    tasks/YYYY-MM-DD-slug.md         # owned by ainotes-tasks
    daily/YYYY-MM-DD.md              # owned by ainotes-daily-plan
    INDEX.md    # tag -> files map, kept up to date incrementally
    PRS.md      # PR ledger, owned by ainotes-pr-tracker
    TASKS.md    # task ledger, owned by ainotes-tasks
```

This is the canonical layout every `ainotes-*` skill and agent uses: all data paths are
`<notes_repo>/db/...`, while git commands always run at the notes repo root
(`git -C <notes_repo> ...`, never `git -C <notes_repo>/db`). Links stored *inside* the data — in
frontmatter `links:`, `INDEX.md`, `PRS.md`, `TASKS.md` — are relative to `db/`
(`notes/...md`, `plans/...md`, `tasks/...md`), never prefixed with `db/`.

**Legacy layout**: older notes repos kept `notes/`, `plans/`, `tasks/`, `daily/`, `INDEX.md`,
`PRS.md`, and `TASKS.md` directly at the repo root. If `<notes_repo>/db/` doesn't exist but any of
those do, don't silently write to either location — tell the user the repo uses the legacy layout
and offer to migrate it: `mkdir -p <notes_repo>/db` then `git -C <notes_repo> mv` each of those
entries that exists into `db/`, committed as one commit (e.g. `"Move notes data under db/"`). Links
need no rewriting since they're already relative to the data root. The `ainotes-setup` skill can
also perform this migration on request. Only proceed with the write once the layout is settled.

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
links: []                   # related notes/plans, relative to db/, e.g. "plans/2026-09-01-api-gateway-fix-token-expiry.md"
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
2. Grep `<notes_repo>/db/` for matching `domain`/`epic`/`repo` (filenames only, `grep -l`) to find
   related earlier notes, and link them via `links: []` if relevant.
3. Write the body and hand off to `notetaker` with `type: note`, `status: n/a` and the frontmatter
   above. It writes `<notes_repo>/db/notes/YYYY-MM-DD-slug.md`, appends the file under each of its
   `domain`/`tags` sections in `db/INDEX.md` (creating a section if new — never rewriting the whole
   file), and commits directly on `main` (`"Add note: <slug>"`).

## Adding/updating a plan (including via ainotes-task)

1. Ask about an epic if not already stated, same as step 1 above.
2. Hand off to `notetaker` with `type: plan`, `status: planned`, `repo`/`worktree` filled in and the
   approved plan as the body. It writes `<notes_repo>/db/plans/YYYY-MM-DD-<repo>-slug.md`, appends it to
   `db/INDEX.md` under its tags, and commits on `main` (`"Add plan: <slug>"`).
3. When `ainotes-task` reaches its step 6 (Jira ticket, if configured), hand `notetaker` a
   frontmatter-only update of the same plan (`jira` when a ticket exists, `status: in-progress`);
   it commits `"Update plan: <slug> (status -> in-progress)"`. The plan's body is never touched.

Do not start executing a plan as part of writing it — plans are captured here, executed elsewhere via
`ainotes-task`.

## When a plan is executed (ainotes-task step 10)

The plan file's body is **immutable** once written — it should always read exactly as originally
approved, so it stays a reliable record of what was agreed. Never append results into it.

Instead, when `ainotes-task` finishes a task:

1. Write the body of a **new** note (`type: note`) recording what happened: repo, branch/worktree,
   Jira ticket (if any), review outcome, whether it was committed, and any follow-ups. Give it the same
   `domain`/`epic` as the plan, plus `links: ["plans/<plan-filename>"]`.
2. Hand `notetaker` both changes in one call: the new note, and a frontmatter-only update of the plan
   flipping `status` to `done` (or `in-review`) and adding the new note's filename to its `links: []`
   (body untouched). It writes `<notes_repo>/db/notes/YYYY-MM-DD-slug.md`, appends the new note to
   `db/INDEX.md` under its tags, and commits both on `main` (`"Complete plan: <slug>"`).

## INDEX.md format

`<notes_repo>/db/INDEX.md`; entries are paths relative to `db/` (no `db/` prefix):

```markdown
## <tag>
- notes/2026-09-03-worktree-notes.md
- plans/2026-09-01-api-gateway-fix-token-expiry.md
```

Edit only the affected tag sections when adding an entry; never regenerate the whole file from scratch.
