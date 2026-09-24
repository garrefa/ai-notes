---
name: ainotes-pr-tracker
description: >-
  Maintain <notes_repo>/PRS.md (the notes repo is `notes_repo` in .ai-notes/config.yml), a master ledger of every PR opened across this workspace's repos and its merge/close status. Register a row whenever a PR is opened in any workspace repo (gh pr create, ainotes-task, or ad hoc). Triggered on demand by "check prs" / "check PR status" — reconciles every pending row against GitHub, moves the ones that merged or closed, and reports two lists: updated and still pending.
---

# PR Tracker (ainotes-pr-tracker)

Companion to `ainotes-notes`: keeps one always-current ledger of every PR this workspace has opened, so
"did we ever merge that?" doesn't require re-deriving it from memory or re-scrolling GitHub. This
skill owns `<notes_repo>/PRS.md` — `ainotes-notes` doesn't touch it.

(`<notes_repo>` below means the `notes_repo` value from the workspace's `.ai-notes/config.yml`, and
`<vcs.org>` means its `vcs.org` value — see the `ainotes-notes` skill for the config-discovery rule. The
`Jira` column holds `—` for every row when the config has no `jira` block.)

## Ledger file

`<notes_repo>/PRS.md` — a single living document, not dated like `notes/`/`plans/` files. Four
sections, each a table. Edit only the affected rows/section — never regenerate the whole file.

The fourth section, **Pending — Detail**, is script-generated: the optional, non-AI refresh script
(`<skill base dir>/../../tools/check-prs.sh`, see "Optional: standalone refresh script" below) fills it
with per-PR deep status (CI, reviews, code owners, unresolved comments) for everything still open. Don't
hand-edit it; when registering or moving rows by hand, leave it as it is.

**Never add extra columns to `PRS.md`'s tables, and keep all content below the `## Pending (open)`
heading to the four tables** — when `check-prs.sh` runs it regenerates everything after that heading
(see below) and will silently drop any extra column, prose, or section there.

```markdown
# PR Tracker

## Pending (open)
| PR | Repo | Opened | Jira | Last checked (UTC) |
|---|---|---|---|---|
| [#42](https://github.com/acme/billing-service/pull/42) | billing-service | 2026-09-04 | PROJ-123 | 2026-09-04 |

## Merged
| PR | Repo | Opened | Merged | Jira |
|---|---|---|---|---|

## Closed (not merged)
| PR | Repo | Opened | Closed | Jira |
|---|---|---|---|---|

## Pending — Detail
| PR | Title | Open for | Last commit | CI | Behind main? | Reviews | Pending code owners | Unresolved comments |
|---|---|---|---|---|---|---|---|---|
```

If the file doesn't exist yet, create it from the bundled template
(`<skill base dir>/../../templates/notes-repo/PRS.md`), which has all four sections empty, before the
first row is appended. If the template isn't reachable, create it with exactly this skeleton:

```markdown
# PR Tracker

Master ledger of every PR opened across this workspace's repos and its merge/close status. Kept
in place (not dated) — see the `ainotes-pr-tracker` skill for how this file is maintained and how
"check prs" reconciles it against GitHub. Edit only the affected rows/section; never regenerate the
whole file.

**Do not add extra columns, prose, or sections below the `## Pending (open)` heading** — when
`check-prs.sh` runs, it keeps everything above that heading verbatim and regenerates everything after
it: the Pending (open) and Pending — Detail tables are rebuilt from scratch, and the Merged / Closed
tables keep only their existing rows plus any newly moved ones.

## Pending (open)

| PR | Repo | Opened | Jira | Last checked (UTC) |
|---|---|---|---|---|

## Merged

| PR | Repo | Opened | Merged | Jira |
|---|---|---|---|---|

## Closed (not merged)

| PR | Repo | Opened | Closed | Jira |
|---|---|---|---|---|

## Pending — Detail

_Regenerated wholesale on each deep check — not an accumulating log._

| PR | Title | Open for | Last commit | CI | Behind main? | Reviews | Pending code owners | Unresolved comments |
|---|---|---|---|---|---|---|---|---|
```

## Registering a PR (whenever one gets opened)

Immediately after running `gh pr create` (or otherwise opening a PR) in any workspace repo — whether
from `ainotes-task`, another PR-opening skill, or an ad hoc request — append a row to **Pending
(open)** with today's date and the Jira key if one exists (`—` if none). Commit on the notes
repo's `main`:

```bash
git -C <notes_repo> add PRS.md
git -C <notes_repo> commit -m "Track PR: <repo>#<number>"
```

Do this before reporting the opened PR back to the user, not as an afterthought.

## "check prs"

Trigger phrases: `check prs`, `check PR status`, `check pr status`, "check on our PRs", or any
request to reconcile the ledger.

1. Read `<notes_repo>/PRS.md`'s **Pending (open)** table. If it's empty, report that plainly and stop.
2. For each row, check its real state (independent rows can run in parallel):
   ```bash
   gh pr view <number> --repo <vcs.org>/<repo> --json state,mergedAt,closedAt,url
   ```
3. For any row whose state changed:
   - `MERGED` → move the row to **Merged**, recording the merge date (from `mergedAt`, date only).
   - `CLOSED` (and not merged) → move the row to **Closed (not merged)**, recording the close date.
   - Still `OPEN` → leave it in **Pending**, refresh `Last checked` to today.
4. Commit the update — one commit covering every row that moved this pass is fine:
   ```bash
   git -C <notes_repo> add PRS.md
   git -C <notes_repo> commit -m "Update PR tracker: <repo>#<number> -> merged|closed[, ...]"
   ```
5. Report back to the user as two lists:
   - **Updated** — PRs that moved this pass, with their new status (merged/closed) and date.
   - **Still pending** — PRs that remain open.
   If nothing moved, say so plainly ("no PRs changed status") instead of omitting the section.

## Optional: standalone refresh script

The toolkit ships `<skill base dir>/../../tools/check-prs.sh`, an AI-free script that does the same
reconciliation mechanically (no narrative synthesis) and also runs
`gh search prs --owner <vcs.org> --author @me --state open` to fold in open PRs you authored that
aren't in the ledger yet (e.g. opened outside Claude). It needs only `gh` (authenticated) and `jq`.
Usage: `check-prs.sh [--dry-run] [--verbose] [--org ORG] [PRS.md path]` — the `PRS.md` path is optional
(by default it's found via `.ai-notes/config.yml` as `<workspace>/<notes_repo>/PRS.md`), `--org`
overrides `vcs.org`, `--dry-run` prints the diff without writing or committing, and `--verbose` logs
each step.

What a run does to the file: everything up to and including the `## Pending (open)` heading is copied
verbatim; everything after it is regenerated — the Pending (open) table is rebuilt from live GitHub
state (rows that merged or closed move out, newly discovered PRs are added), the Merged and Closed
(not merged) tables keep their existing rows and gain the newly moved ones, and the Pending — Detail
table is rebuilt from scratch. Any non-table content below that heading is dropped. Unless
`--dry-run` is given, it then commits `PRS.md` in the notes repo. Using it is entirely optional —
nothing in this skill runs it automatically; if you want it on a schedule, set that up yourself (cron,
launchd, a CI job, etc.). When it has run, treat its changes to `PRS.md` like any other update.

## Relationship to ad hoc tracking notes

A one-off `notes/YYYY-MM-DD-*-tracking.md` note (e.g. a `/loop`-driven check on a specific handful of
PRs tied to one incident/epic) can still exist alongside this ledger for its own narrative/running-log
purpose — but every PR it covers should also get a row here, so this ledger stays the single complete
record even after the ad hoc note's job ends.
