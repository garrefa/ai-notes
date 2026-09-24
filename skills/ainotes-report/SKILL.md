---
name: ainotes-report
description: Compile a work-review / weekly / monthly / quarterly report from the notes repo's accumulated notes, plans, and db/PRS.md / db/TASKS.md ledgers for a given date window. Produces a chronological note in the notes repo plus a visual dashboard (a published Artifact when a publishing tool is available, otherwise a self-contained HTML file next to the note). When Jira is configured, every Jira ticket mentioned anywhere in the report is rendered as a link, never a bare key. Trigger on "work review", "weekly report", "monthly report", "quarterly report", "performance review", or "compile my report".
---

# Work Report

Turns the raw material already accumulated in the notes repo (`<notes_repo>` — the `notes_repo`
value from the workspace's `.ai-notes/config.yml`; see the `ainotes-notes` skill for the
config-discovery rule and the canonical `db/` layout) into a reviewable report for a requested window. This skill only compiles — it never invents work that
isn't backed by a note, plan, PRS.md row, or TASKS.md row.

If an earlier report note exists in `<notes_repo>/db/notes/` (tagged `performance-review`), match its
structure unless the user asks for something different.

## Trigger phrases

"work review", "weekly report", "monthly report", "quarterly report", "performance review",
"compile my report" — for any of these, run this skill rather than assembling something ad hoc.

## Step 1 — Confirm the window

Ask (if not already stated in the request):
- Start and end date. Convert anything relative ("this week", "Q3") to absolute dates.
- Scope: whole workspace (default) or a specific repo/epic.

Recording only goes back as far as the notes repo itself does — the earliest `date` across all
frontmatter in `db/notes/*.md` and `db/plans/*.md` (Step 2's `earliest_recorded_date`) is the
practical start of recorded history. If the requested window starts before that
earliest date, say so plainly in the report's opening line rather than presenting a thin window as if
it were complete — don't silently pad it out.

## Step 2 — Gather source material

Gathering is a read-only sweep, so it runs on a Haiku agent and the main thread compiles from its
output. Spawn the `notes-extractor` agent (named `ainotes:notes-extractor` when AINotes is installed
as a plugin). If neither name is available, spawn a general-purpose agent with `model: haiku` and give
it the contents of `<skill base dir>/../../agents/notes-extractor.md` as its instructions. Pass
`{window_start, window_end, scope, notes_repo_path, jira_base_url?}`; it returns JSON
`{items: [{file, date, type, repo, domain, epic, prs: [{url, ledger_status}], jira, tasks: [{file, status}],
outcome_1line, cost?}], counts: {notes, plans, tasks, daily, prs}, files: [...], earliest_recorded_date}`.

Before compiling, validate it cheaply: spot-read 2–3 of the listed `files` and confirm their items
match (date, PRs, outcome); check that `counts` agree with `items` (e.g. `counts.notes` equals the
number of `type: note` items). If something's off, re-run the agent with the discrepancy spelled out
rather than reading everything yourself. Then compile **only** from that JSON — no extra scanning.

What the agent covers (all sourced from `<notes_repo>/db/`, never from re-deriving via fresh Jira/GitHub mining):

1. `db/notes/*.md` and `db/plans/*.md` whose `date` (or plan's linked outcome note date) falls in the window
   — filter via frontmatter, not by guessing from filenames alone.
2. `db/INDEX.md` to catch anything tagged for the window's epics that a plain date scan might miss.
3. `db/PRS.md` — cross-reference every PR mentioned in the window's notes against its **Merged** /
   **Pending** / **Closed** section for current status, since a note may predate a later merge.
4. `db/TASKS.md` (and the linked `db/tasks/*.md` files) — tasks created in the window, and tasks that
   entered a closed status in the window (their `Completed` date). What counts as closed comes from
   `task_statuses` in `.ai-notes/config.yml` (entries with `closed: true`; defaults `done` and
   `dropped` when the key is absent). Only a task in the **done status** — the `done` key if it's
   configured, otherwise the first closed status — counts as finished work; `dropped` (and any other
   closed status) means abandoned, not accomplished.
   Legacy `status: open` counts as the first non-closed status, legacy `status: done` as `done`.
5. Each source note's "Cost" section (if present) for the token/cost rollup.

The agent reports each task's `status` key as written; applying `task_statuses` (done vs. dropped vs.
still open) is your job, per item 4 above.

## Step 3 — Compile the report

Use these sections:

- **Headline achievements** — concrete outcomes, not activity descriptions.
- **Epics / initiatives touched** — one bullet per epic, what changed under it.
- **Investigation quality signal** (only when a real investigation happened) — the hypothesis trail,
  what ruled each one out, what confirmed the real cause. Worth keeping even when a hypothesis was
  wrong — it's a positive signal, not a caveat to bury.
- **Shipped work** table: `Repo | PR | Title | Status | Jira | Epic` (drop the `Jira` column when
  config has no `jira` block).
- **Metrics**: PRs opened/merged, Jira tickets created (only when Jira is configured), tasks completed
  (done status only — never count `dropped` or other closed statuses here; give those their own
  count if any, labelled as dropped), repos touched, epics touched, and the AI
  token/cost rollup (sum each note's Cost section; if a USD figure isn't available, report tokens only
  and flag it as directional).
- **Dropped tasks** (only if any entered `dropped` — or another closed status besides the done status — in the
  window) — a short separate list, title plus the reason from the task's `## Updates` if one was
  given. Never fold these into Headline achievements, Shipped work, or the completed count.
- **Open items** — anything still unresolved (tasks still in a non-closed status show that status), including items resolved mid-window (show the strikethrough
  + resolution note, don't just delete the line).
- **Career-ladder alignment** — check the window's work against whichever career-ladder checklist note
  exists in `<notes_repo>/db/` (tagged `career-ladder-checklist`; skip this section if there is none), organized by the checklist's own
  categories: what's strongly evidenced (with specific PRs/notes as receipts), and what's a genuine
  gap or unknown. **Never** flag a decision as failing to reach team-facing documentation based on it only
  appearing in the notes repo — that repo is a personal working log, not team-facing documentation;
  team-facing documentation (PR descriptions, wikis, ADRs) lives separately and later, and its absence or
  presence there is simply not observable from this data source. When a checklist category (mentorship,
  stakeholder communication, etc.) has no visible evidence, say so as an *unknown this data source can't
  see*, not a confirmed gap — this compilation only ever sees solo technical work, never 1:1s, mentoring,
  or meetings.

If a section has nothing to report for the window, say so explicitly ("no investigations this window")
rather than omitting it silently.

## Step 4 — Jira links (non-negotiable when Jira is configured)

If the workspace's `.ai-notes/config.yml` has no `jira` block, skip this step: there are no Jira keys
to link, so don't invent any and don't mention Jira in the report.

Otherwise, every Jira key that appears anywhere in the report — headline bullets, epic section, the shipped-work
table, metrics, open items — must be a markdown link, never a bare key:

```
[PROJ-123](https://acme.atlassian.net/browse/PROJ-123)
```

Base URL is `jira.base_url` from the workspace's `.ai-notes/config.yml` (see `ainotes-notes`
for the discovery rule), e.g. `https://acme.atlassian.net/browse/`.
This applies to every ticket key format used in this workspace (`<jira.project_key>-XXXX`, e.g.
`PROJ-123`, and any epic keys like `PROJ-100` that resolve to real Jira issues — link those the same
way; skip linking only for a key that's explicitly noted as never having had a ticket created). Before
finishing, scan the drafted report for any remaining bare `[A-Z]+-[0-9]+` pattern and fix it — this is
the one thing worth double-checking mechanically rather than trusting first-pass output.

PR references keep their existing GitHub link format; this rule is Jira-specific.

## Step 5 — Produce the deliverables

Every report gets the durable note, with no exceptions for a quick or small window — it's the
non-negotiable one (the durable record; the dashboard is the presentation layer on top of it). Title
both the note and the dashboard with the org name when `org_name` is set in config (e.g. "Acme work
report — 2026-Q3"); otherwise just "Work report — <period>".

1. **Durable note** — write `<notes_repo>/db/notes/YYYY-MM-DD-<period>-summary.md` (`type: note`, tagged
   `performance-review` plus every epic touched, plus `career-ladder` whenever Step 3's alignment
   section is included — never `career-ladder-checklist`, which belongs only to the checklist note
   itself, so reports never get mistaken for the checklist) with the **full compiled report as the body** — every section from Step 3,
   including career-ladder alignment, verbatim, not a trimmed-down pointer to the dashboard. Follow the
   frontmatter schema from `ainotes-notes`. Hand the write to the `notetaker` agent (named
   `ainotes:notetaker` when AINotes is installed as a plugin; if neither name is available, spawn a
   general-purpose agent with `model: haiku` and give it the contents of
   `<skill base dir>/../../agents/notetaker.md` as its instructions) with
   `{type: note, slug, frontmatter fields, body, commit_message: "Add report: <period>"}`; it writes,
   indexes and commits on `main`, returning `{path, index_sections, sha, flags}`.
2. **Dashboard** — an HTML page summarizing the same content visually (headline achievements,
   shipped-work table, metrics) for easy sharing/skimming. If an Artifact/publishing tool is
   available, publish it as an Artifact (load the `artifact-design` skill first, if available).
   Otherwise write a self-contained HTML file next to the report note
   (`<notes_repo>/db/notes/YYYY-MM-DD-<period>-summary.html`, inline CSS, no external requests) — or skip
   the dashboard if the user prefers. Link back to the notes-repo note isn't necessary (it's local), but
   keep the dashboard self-contained with the same PR (and, if configured, Jira) links as the note.

Report the note's path and the dashboard's location (Artifact URL or HTML file path, or that it was
skipped) back to the user when done.
