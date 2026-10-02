- New `ainotes-review-notes` skill and `tools/review-note.sh`: files a finished PR review as
  `<notes_repo>/reviews/<first-date>-<repo>-<n>.md`, one note per PR. The note holds the verdict,
  summary, key changes, risk, size/CI, findings, the full comments as posted, and private
  follow-ups. A re-review appends a section and a review-history row. New notes are indexed in
  `INDEX.md` under `pr-review`, the repo, its domains and Jira keys, and only the note and
  `INDEX.md` are committed. AI-free and JSON-in, so session reviews and headless review scripts
  share one writer.
- Notes-repo template documents the new `reviews/` folder.
