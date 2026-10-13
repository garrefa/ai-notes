---
name: ax-babysit-prs
description: Loop over every PR we have open across the workspace (from <notes_repo>/PRS.md's Pending table, where the notes repo is the folder holding `.config.yml`) and drive each one toward merge — update it against its base branch, resolve conflicts, rerun failed CI jobs, reply to and fix review comments that make sense, then (only if `ci.deploy_trigger_comment` is configured) ask before posting that deploy comment. Never merges. Use when the user says "babysit prs", "babysit open prs", or "keep an eye on our PRs" — usually run under the `loop` skill so it keeps checking until nothing is left.
---

# Babysit PRs

Drives every PR this workspace currently has open toward merge, with minimal hand-holding — but never
deploys without asking first. Designed to run repeatedly under `/loop babysit prs` (or self-paced
`/loop` with no interval): each pass processes every pending PR once, then either schedules another
pass or stops because nothing is left to do.

## Scope: which PRs

(`<notes_repo>` below means the folder holding the workspace's `.config.yml`,
`<vcs.org>` its `vcs.org` value, and `<deploy comment>` its `ci.deploy_trigger_comment` value — see
`ax-notes` for the config-discovery rule.)

Read `<notes_repo>/PRS.md`'s **Pending (open)** table (see `ax-pr-tracker`) — that's the list of
PRs we opened and haven't resolved yet. If the user names a specific PR ("babysit PR #42"), scope to
just that row instead of the whole table.

## State file (survives passes and sessions)

Each PR has `<notes_repo>/.state/babysit/<owner>-<repo>-<n>.json` (`.state/` is untracked, so it never
reaches git). It is the loop's memory: timers and once-per-head rules live here, never in a cron or
`/loop` prompt. Every key is optional; a missing file means "nothing recorded yet".

```json
{
  "last_deploy_comment_sha": "<head sha the deploy comment was last posted for>",
  "review_request": {"channel": "#pr-review", "ts": "1760000000.000100", "at": "2026-10-12T14:03:00Z"},
  "last_reminder_at": "2026-10-12T15:10:00Z",
  "last_bot_rerequest_at": "2026-10-12T14:30:00Z",
  "known_blocker": "<one line: a real failure already diagnosed; replaces rerun_already>",
  "bot_reviews_handled": {"<bot login>": "<review id>"},
  "supersedes": ["acme/repo#12"],
  "notes": "<free text>"
}
```

- **Read it at the start of each pass** (create the directory on first write) and pass its path to
  `pr-poller` as `state_file`. Other skills may add keys (`ax-pr-review-request` writes
  `review_request`); keep unknown keys when you rewrite the file.
- **Write it after acting**, in one write per PR per pass (read-modify-write, so a concurrent
  `ax-pr-review-request` isn't clobbered). Timestamps are ISO 8601 UTC.
- `known_blocker` replaces the old `rerun_already` input: set it when a failure is a real blocker
  (so it isn't rerun again), clear it once the job passes. An explicit `rerun_already: true` is still
  honoured, so rows built by hand keep working.
- **Delete the file** when the PR leaves Pending (merged or closed), after any post-merge work.

## Optional policies

`<skill base dir>/policies.md` holds the behaviours that only apply when their config key is set:
readiness label and merge policy, deploy comment policy, environment lock, review reminders with
office hours, post-merge hooks, superseded bot PRs, and the stop/cadence rule. **All are off by
default**; read that file only when one of those keys (`review.ready_label`, `merge.*`,
`ci.deploy_policy`, `ci.lock_label`, `reminders`, `on_merge`) is configured, or a PR carries
`supersedes`.

## One pass

Polling is cheap and mechanical, so it runs on a Haiku agent; the main thread only spends effort on
what actually needs judgment.

1. **Poll every pending PR at once.** Spawn the `pr-poller` agent (named `ainotes:pr-poller` when
   AINotes is installed as a plugin). If neither name is available, spawn a general-purpose agent with
   `model: haiku` (Haiku 5.5) and give it the contents of `<skill base dir>/../../agents/pr-poller.md` as its
   instructions. Pass it the pending rows as `[{repo, number, url, state_file, rerun_already?}]` (`repo`
   as `<vcs.org>/<repo>`; `state_file` as above — a non-null `known_blocker` in it stops reruns), and a
   `config` object built from whichever of `review.bots`, `ci.gate_check`, `ci.no_services_check` are set. It returns one YAML
   record per PR:
   `{pr, head_sha, labels, state, mergeable, behind, updated_branch, ci: {status, failed: [{job,
   run_id, log_tail}]}, rerun_done, unresolved_comments: [{id, author, gist_1line}], review:
   {decision, requested_reviewers, requested_teams, approved_by}, bot_reviews: [{login, review_id,
   state, commit_id, on_head, submitted_at, unresolved_threads, skipped_or_limited, actionable}],
   gate: {check, conclusion, unmet}, ready_for_deploy}`.
   It has already done the safe mechanical steps — a non-destructive
   `update-branch` when the branch was behind with no conflicts (a merge commit, never a history
   rewrite), and at most one `gh run rerun --failed` per PR — so don't repeat those or re-fetch state
   it already reported.

2. **Act only on non-empty fields**, per PR:
   - **`state` is `MERGED`/`CLOSED`** → nothing to do but the ledger update (step 3).
   - **`mergeable: CONFLICTING`, or `updated_branch` failed** → resolving conflicts needs the actual
     files: use (or create) a worktree for the branch (plain `git worktree add`, or the repo's own
     worktree tooling if it has one), merge the base branch in locally, and resolve conflicts **only
     when the resolution is unambiguous** (e.g. a lockfile regenerated from the manifest, a generated
     file, a clean textual merge with no logic on both sides). Push the merge commit. If a conflict
     touches actual logic on both sides and the right resolution isn't obvious, stop and ask the user
     rather than guessing — this is exactly the kind of judgment call that shouldn't be automated
     silently.
   - **`ci.failed` non-empty** → decide from each `log_tail` whether it's a flake (the poller's rerun,
     if `rerun_done`, gets a real chance to finish before the next pass) or a real failure. Pull a
     longer log only for a job you're actually diagnosing (`gh run view <run-id> --log-failed | tail -n 50`).
     A job that keeps failing for a real reason is a genuine blocker: surface it, and pass
     `rerun_already: true` for that PR on later passes instead of rerunning it over and over.
   - **`unresolved_comments` non-empty** → the gists are pointers; fetch the full thread only for the
     comments you act on. If a code-review / PR-feedback skill is available in this environment,
     delegate the "is this feedback sound" judgment and commit semantics to it rather than reinventing
     that triage here; otherwise apply the same judgment yourself. Only act on comments that haven't
     already been addressed. Reply on the thread explaining what was done (or why not) for anything
     you touch; leave alone anything that's a matter of taste, out of scope, or already handled.
   - **`bot_reviews` with `actionable` entries** (review-body comments) → bots such as code-review
     apps put nitpicks, "outside the diff" notes and "actionable comments" in the review body, not in
     threads, so they never show up in `unresolved_comments`. For each bot whose latest `review_id`
     isn't already in `bot_reviews_handled`, treat every `actionable` entry like an unresolved
     comment: fix it if it is sound (same triage as above), then reply **on the PR** (a normal PR
     comment, one per bot review) saying what was done or why not, per item. Record the `review_id`
     in `bot_reviews_handled` afterwards, whatever you decided, so it isn't answered twice.
   - **Stale bot review** → only when `review.bot_rerequest` is configured. For each bot in
     `bot_reviews`: if `state` is `CHANGES_REQUESTED` (or `skipped_or_limited` is true), its
     `unresolved_threads` is 0 (everything it raised is fixed or replied to) and the review is the
     latest the bot has made, then post `review.bot_rerequest.comment` on the PR, set
     `last_bot_rerequest_at`, and repeat only once `review.bot_rerequest.every_min` minutes have
     passed since the last one, until the bot approves or comments. Never post it while the bot has
     unresolved threads or while its latest review is on a head you haven't finished fixing.
   - **`ready_for_deploy: true`** → the PR is ready — this skill does not merge it or set auto-merge.
     First apply the readiness gate and merge policy (`review.ready_label`, `merge.manual_repos`,
     `merge.queue_file`), then:
     - If `ci.deploy_trigger_comment` is null or absent: report the PR as ready and stop there for
       this PR — never post any deploy comment.
     - Otherwise follow the deploy comment policy: by default (`ci.deploy_policy: ask`) ask the user,
       *"PR #<n> (<repo>) is green and ready — want me to comment `<deploy comment>` to deploy it?"*,
       and only on an explicit yes post it with
       `gh pr comment <number> --repo <vcs.org>/<repo> --body "<deploy comment>"`. Never post it
       speculatively or bundle multiple PRs' deploy questions into one assumed "yes" — ask per PR.
   - **Lock labels, reminders, merged PRs** → see the matching sections of `policies.md`
     (`ci.lock_label`, `reminders`, `on_merge`); each applies only when its key is configured.

3. **Write the state file** for each PR you acted on (see above), then **update the ledger.** If any PR merged or closed this pass (or you want the Detail table
   refreshed after branch updates / reruns / comment fixes), spawn `ledger-keeper` once for the whole
   pass with `check_prs` — exactly as `ax-pr-tracker`'s "check prs" does (same agent naming and
   fallback, `script` = `<skill base dir>/../../tools/check-prs.sh`, plus `notes_repo_path` and
   `toolkit_dir`). It updates `<notes_repo>/PRS.md` and commits; relay its `updated` list.

## Looping

After a full pass over every pending PR:

- If every PR is now `MERGED`/`CLOSED` (the pending table is empty after this pass' updates), report
  the final summary and **stop** — don't schedule another wakeup.
- If the only remaining blockers are human-only (approvals owed outside office hours, repos the user
  merges manually, decisions only the user can make), stop or stretch the wakeup as described in
  `policies.md` ("Stop and cadence") instead of polling every few minutes.
- If any PR has `supersedes`, list those bot PRs in the report as "can now be closed" (never touch
  them).
- Otherwise, report what happened this pass (per PR: what got fixed, what's still blocking, what's
  waiting on the user) and schedule the next pass. Under `/loop`, that means calling `ScheduleWakeup`
  with a delay sized to what's actually being waited on (CI runs take minutes, not seconds — don't
  poll a 10-minute CI run every 60 seconds).

## What this skill will NOT do without asking first

- Post the configured deploy comment (a per-PR yes/no by default — see the `ready_for_deploy` bullet
  under "One pass" above; only `ci.deploy_policy: auto_after_ready` skips the question — and never at
  all when `ci.deploy_trigger_comment` is unset).
- Resolve a conflict where both sides touched real logic and the right merge isn't obvious.

## What this skill will never do

- Force-push, rewrite history, or close/merge a PR directly — merging stays a human (or deploy
  pipeline) action, never this skill's. At most it queues a guarded `gh pr ready`/`gh pr merge` line
  for the user when `merge.queue_file` is set, and never for `merge.manual_repos`.
