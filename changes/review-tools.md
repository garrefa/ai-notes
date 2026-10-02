- New `ainotes-review-notes` skill and `tools/review-note.sh`: files a finished PR review as
  `<notes_repo>/reviews/<first-date>-<repo>-<n>.md`, one note per PR. The note holds the verdict,
  summary, key changes, risk, size/CI, findings, the full comments as posted, and private
  follow-ups. A re-review appends a section and a review-history row. New notes are indexed in
  `INDEX.md` under `pr-review`, the repo, its domains and Jira keys, and only the note and
  `INDEX.md` are committed. AI-free and JSON-in, so session reviews and headless review scripts
  share one writer.
- New `ainotes-pr-review` skill, `tools/check-pending-pr-reviews` and `tools/pr-review.sh`:
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
- Scheduled jobs: new `tools/schedule.sh` and `ainotes-schedules` skill. You pick which tools run
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
