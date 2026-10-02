- New `ainotes-review-notes` skill and `tools/review-note.sh`: files a finished PR review as
  `<notes_repo>/reviews/<first-date>-<repo>-<n>.md`, one note per PR. The note holds the verdict,
  summary, key changes, risk, size/CI, findings, the full comments as posted, and private
  follow-ups. A re-review appends a section and a review-history row. New notes are indexed in
  `INDEX.md` under `pr-review`, the repo, its domains and Jira keys, and only the note and
  `INDEX.md` are committed. AI-free and JSON-in, so session reviews and headless review scripts
  share one writer.
- New `ainotes-dm-pr-review` skill, `tools/pending-reviews.sh` and `tools/dm-pr-review.sh`:
  - `pending-reviews.sh` lists the PRs requesting your review directly, leaving out dependabot,
    stale and already-approved ones, least recently updated first. It uses only `gh`.
  - With `--review`, it runs a headless `/code-review` (default `high` on Opus) on each one in a
    private checkout, then approves on zero findings or leaves inline comments. PRs already
    reviewed at their current commit are skipped, and Claude only starts when something is
    pending.
  - A monthly USD cap is enforced through `--max-budget-usd`, there is a per-review cost and token
    ledger, and every review is filed via `review-note.sh`.
  - State and config live in `<workspace>/.dm-pr-review/`.
- Notes-repo template documents the new `reviews/` folder.
