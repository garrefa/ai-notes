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
