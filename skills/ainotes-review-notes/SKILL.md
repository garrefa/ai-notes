---
name: ainotes-review-notes
description: Files a finished PR review as a note in the notes repo (`notes_repo` in .ai-notes/config.yml) under reviews/, one note per PR. A re-review of the same PR (e.g. after new commits) adds a dated section and a review-history row. Each note records the verdict, summary, key changes, risk, size/CI, findings, the full comments as posted, and private follow-ups for you. New notes are indexed in INDEX.md (pr-review, repo, domain, Jira keys) and committed. Writing the note is mechanical (tools/review-note.sh, no LLM). Works for reviews done in a Claude session and for scripts or headless reviewers that pipe the review in as JSON. Trigger on "note this review", "save a review note for <PR>", "file the review of <PR>", "add this review to my notes", or right after finishing a PR review when the user wants a record of it.
---

# Review Notes (ainotes-review-notes)

Keeps a durable record of every PR review you do (or have done for you), next to the rest of
the second brain: `<notes_repo>/reviews/<first-review-date>-<repo>-<number>.md`. The note is the
review as it was at the time, including the full comments, even if the PR is later force-pushed,
closed or deleted, plus follow-ups that were never posted.

The writing is done by `tools/review-note.sh`. It takes one review as JSON, so any reviewer can
use it: you in a session, a headless `claude -p` review script, or a human pasting results. This
skill is the session-side wrapper around it.

## Who writes

`tools/review-note.sh` is the only writer for `reviews/` and for the `INDEX.md` lines it adds. It
commits only the note (and `INDEX.md` when it indexed a new note), straight to the notes repo's
branch. It never runs `git add -A` and never pushes. Don't run it at the same moment as a
notetaker or ledger-keeper commit to the same repo: serialize notes-repo writers.

## Filing a review from a session

When a PR review has just been done in the conversation, or the user asks to note one:

1. **Collect PR facts, no LLM:**
   `gh pr view <url> --json url,title,author,baseRefName,headRefOid,headRefName,additions,deletions,changedFiles,statusCheckRollup`.
   CI is `failure` if any check failed, `pending` if any is still running, `success` otherwise, or
   `none` if there are no checks.
2. **Build the review JSON** from what was actually concluded in the conversation. Don't invent
   findings that weren't raised:
   - `verdict`: `approved`, `commented` or `changes_requested`. Use what was actually submitted on
     GitHub. If nothing was submitted, use `commented`.
   - `summary`: 1–3 sentences.
   - `key_changes`: short behavior-level bullets.
   - `risk`: `{level: low|medium|high, reason}`.
   - `findings[]`: `{path, line, severity: blocker|major|minor|nit, title, body}`.
   - `follow_ups[]`: things the user should personally check or ask. These stay private in the
     note.
   - `meta`: optional. Include `github_review_url` if a review was posted, and
     `reviewer: {model, level}` / `cost_usd` / `tokens` / `duration` when known.

   The full shape is in the script's `--help`.
3. **Run it:** `tools/review-note.sh --input <file>`, or pipe the JSON on stdin. Add `--dry-run`
   first if the user wants to see the note before it's written. The script prints the note's path.
4. **Report** the path in one line, plus a warning if the script said `INDEX.md` was skipped.

## Filing from a script

Pipe the JSON to `<workspace>/.claude/tools/review-note.sh` after the review has been published.
A failure to write the note should be logged and must never undo or block the review itself.

## Note format

- **Frontmatter**, refreshed to the latest review: `date` (first review), `last_reviewed`,
  `type: review`, `repo`, `domain` (from `domain_taxonomy`), `tags` (`pr-review` plus Jira keys),
  `pr`, `url`, `title`, `author`, `base`, `head_sha`, `verdict`, `findings` (count per severity),
  `risk`, `jira` (keys found in the title and branch), `reviewer`, `cost_usd`, `total_cost_usd`
  (summed across reviews), `reviews` (count), `tokens`, `duration`, `github_review`, `status`,
  `links`.
- **Body:**
  - `# Review: <repo>#<n> · <title>`
  - `## Review history`: a table with one row per review (date, commit, verdict, findings, risk,
    cost)
  - one `## Review · <date> · <sha7>` section per review, containing:
    - the verdict line
    - Summary
    - Key changes
    - Risk
    - Change at a glance (files, +/−, CI)
    - Findings table
    - Follow-ups for me (checkboxes)
    - the full comments as posted, in a collapsed `<details>` block
    - a link to the GitHub review
- Missing optional fields render as "—" or "None", never as an error.

## What this skill will never do

- Post anything to GitHub or Slack. It only records a review that already happened.
- Rewrite an earlier review section. A re-review appends; only the frontmatter and the history
  table change.
- Index into an `INDEX.md` that has someone else's uncommitted edits. It skips indexing and says so.
- Push the notes repo.
