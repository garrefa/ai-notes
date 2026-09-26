---
name: ainotes-babysit-prs
description: Loop over every PR we have open across the workspace (from <notes_repo>/PRS.md's Pending table, where the notes repo is `notes_repo` in .ai-notes/config.yml) and drive each one toward merge — update it against its base branch, resolve conflicts, rerun failed CI jobs, reply to and fix review comments that make sense, then (only if `ci.deploy_trigger_comment` is configured) ask before posting that deploy comment. Never merges. Use when the user says "babysit prs", "babysit open prs", or "keep an eye on our PRs" — usually run under the `loop` skill so it keeps checking until nothing is left.
---

# Babysit PRs

Drives every PR this workspace currently has open toward merge, with minimal hand-holding — but never
deploys without asking first. Designed to run repeatedly under `/loop babysit prs` (or self-paced
`/loop` with no interval): each pass processes every pending PR once, then either schedules another
pass or stops because nothing is left to do.

## Scope: which PRs

(`<notes_repo>` below means the `notes_repo` value from the workspace's `.ai-notes/config.yml`,
`<vcs.org>` its `vcs.org` value, and `<deploy comment>` its `ci.deploy_trigger_comment` value — see
`ainotes-notes` for the config-discovery rule.)

Read `<notes_repo>/PRS.md`'s **Pending (open)** table (see `ainotes-pr-tracker`) — that's the list of
PRs we opened and haven't resolved yet. If the user names a specific PR ("babysit PR #42"), scope to
just that row instead of the whole table.

## One pass

Polling is cheap and mechanical, so it runs on a Haiku agent; the main thread only spends effort on
what actually needs judgment.

1. **Poll every pending PR at once.** Spawn the `pr-poller` agent (named `ainotes:pr-poller` when
   AINotes is installed as a plugin). If neither name is available, spawn a general-purpose agent with
   `model: haiku` and give it the contents of `<skill base dir>/../../agents/pr-poller.md` as its
   instructions. Pass it the pending rows as `[{repo, number, url, rerun_already?}]` (`repo` as
   `<vcs.org>/<repo>`; set `rerun_already: true` for any PR whose failure you've already judged a real
   blocker, so it isn't blindly rerun again). It returns one YAML record per PR:
   `{pr, state, mergeable, behind, updated_branch, ci: {status, failed: [{job, run_id, log_tail}]},
   rerun_done, unresolved_comments: [{id, author, gist_1line}], ready_for_deploy}`.
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
   - **`ready_for_deploy: true`** → the PR is ready — this skill does not merge it or set auto-merge.
     - If `ci.deploy_trigger_comment` is null or absent: report the PR as ready and stop there for
       this PR — never post any deploy comment.
     - Otherwise, ask the user: *"PR #<n> (<repo>) is green and ready — want me to comment
       `<deploy comment>` to deploy it?"* Only on an explicit yes, post it:
       `gh pr comment <number> --repo <vcs.org>/<repo> --body "<deploy comment>"`. Never post it
       speculatively or bundle multiple PRs' deploy questions into one assumed "yes" — ask per PR.

3. **Update the ledger.** If any PR merged or closed this pass (or you want the Detail table
   refreshed after branch updates / reruns / comment fixes), spawn `ledger-keeper` once for the whole
   pass with `check_prs` — exactly as `ainotes-pr-tracker`'s "check prs" does (same agent naming and
   fallback, `script` = `<skill base dir>/../../tools/check-prs.sh`, plus `notes_repo_path` and
   `toolkit_dir`). It updates `<notes_repo>/PRS.md` and commits; relay its `updated` list.

## Looping

After a full pass over every pending PR:

- If every PR is now `MERGED`/`CLOSED` (the pending table is empty after this pass' updates), report
  the final summary and **stop** — don't schedule another wakeup.
- Otherwise, report what happened this pass (per PR: what got fixed, what's still blocking, what's
  waiting on the user) and schedule the next pass. Under `/loop`, that means calling `ScheduleWakeup`
  with a delay sized to what's actually being waited on (CI runs take minutes, not seconds — don't
  poll a 10-minute CI run every 60 seconds).

## What this skill will NOT do without asking first

- Post the configured deploy comment (step 5 — always a per-PR yes/no; never at all when
  `ci.deploy_trigger_comment` is unset).
- Resolve a conflict where both sides touched real logic and the right merge isn't obvious.

## What this skill will never do

- Force-push, rewrite history, or close/merge a PR directly — merging stays a human (or deploy
  pipeline) action, never this skill's.
