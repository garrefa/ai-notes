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

## One pass, per PR

For each pending PR, in whichever repo it lives in:

1. **Refresh real state first.** `gh pr view <number> --repo <vcs.org>/<repo> --json state,mergedAt,closedAt,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments,baseRefName,headRefName`.
   If it's already `MERGED` or `CLOSED`, hand off to `ainotes-pr-tracker` to move its row and skip the
   rest of this loop for that PR.

2. **Keep it current with base.** If `mergeable` is `CONFLICTING` or the branch is behind, bring it
   up to date:
   - Try the non-destructive path first: `gh api repos/<vcs.org>/<repo>/pulls/<number>/update-branch -X PUT`
     (this merges the base branch in with a merge commit — it never rewrites history, so it's safe to
     do without asking).
   - If that 422s because of real conflicts, resolving them needs the actual files: use (or create) a
     worktree for the branch (plain `git worktree add`, or the repo's own worktree tooling if it has
     one), merge the base branch in locally, and resolve conflicts **only when the resolution is
     unambiguous** (e.g. a lockfile regenerated from the manifest, a generated file, a clean textual
     merge with no logic on both sides). Push the merge commit. If a conflict touches actual logic on
     both sides and the right resolution isn't obvious, stop and ask the user rather than guessing —
     this is exactly the kind of judgment call that shouldn't be automated silently.

3. **Get CI green.** From `statusCheckRollup`, find any `FAILURE`/`ERROR` runs and rerun them:
   `gh run rerun <run-id> --failed`. Give a rerun a real chance to finish before deciding it's still
   red — don't rerun the same job over and over in one pass. If a job keeps failing for a real reason
   (not flake), don't keep blindly rerunning it — surface it as a genuine blocker instead.

4. **Handle review comments.** If a code-review / PR-feedback skill is available in this environment,
   delegate the "is this feedback sound" judgment and commit semantics to it rather than reinventing
   that triage here; otherwise apply the same judgment yourself. Only act on comments that are still
   unresolved and haven't already been addressed. Reply on the thread explaining what was done (or why
   not) for anything you touch; leave alone anything that's a matter of taste, out of scope, or already
   handled.

5. **Report readiness, don't merge.** Once mergeable, CI green, and comments handled, the PR is ready
   — this skill does not merge it or set auto-merge.
   - If `ci.deploy_trigger_comment` is null or absent: report the PR as ready and stop there for this
     PR — never post any deploy comment.
   - Otherwise, ask the user: *"PR #<n> (<repo>) is green and ready — want me to comment
     `<deploy comment>` to deploy it?"* Only on an explicit yes, post it:
     `gh pr comment <number> --repo <vcs.org>/<repo> --body "<deploy comment>"`. Never post it
     speculatively or bundle multiple PRs' deploy questions into one assumed "yes" — ask per PR.

6. **Update the ledger.** Whenever a PR's status changed this pass (merged, closed, or just needed a
   base-branch update / CI rerun / comment fix worth recording), hand off to `ainotes-pr-tracker` to
   update `<notes_repo>/PRS.md` and commit.

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
