# ax-babysit-prs policies

Optional behaviours of `ax-babysit-prs`, each switched on by a config key (see
`tools/config.example.yml`). **With a key unset, the step is skipped and the skill behaves as it did
before.** Read only the sections whose keys are configured. All timers and once-per-head facts live
in the PR's state file (see `SKILL.md`), never in a loop prompt. "Self" below is
`pr_review.self_github_login`, or `gh api user --jq .login` when unset.

## Readiness gate and merge policy (`review.ready_label`, `merge.*`)

- **Ready** means the poller's `ready_for_deploy` is true **and**, when `review.ready_label` is set,
  that label is on the PR's *current head*. The label can't carry a SHA, so compare the time of the
  latest `labeled` event for it (`gh api repos/<o>/<r>/issues/<n>/events`) with the head commit's
  date: a commit pushed after the label means the label is stale and the PR is not ready.
- **Label missing or stale**: if a ship / PR-readiness skill is available in this environment (for
  example `ship-pr`), run it on the PR rather than asking the user. Never park a PR waiting on a
  human "sandbox decision" or similar; if the skill itself needs a human input, report exactly that
  input as the blocker.
- **Guarded commands**: when a guard blocks `gh pr ready` or `gh pr merge` and `merge.queue_file` is
  set, append the command **without the leading `gh`**, one per line, to
  `<notes_repo>/<merge.queue_file>` (create it if missing; skip a line already present), and tell
  the user what was queued. With `queue_file` unset, only report it.
- **Manual-merge repos** (`merge.manual_repos`, repo names without the org): never queue, run or
  suggest a merge for them. Report "ready, merge it yourself" once all its blockers are clear.
  This skill never merges in any case.

## Deploy comment (`ci.deploy_trigger_comment`, `ci.deploy_policy`, ...)

Applies only when `ci.deploy_trigger_comment` is set; otherwise nothing is ever posted.

- `ci.deploy_policy: ask` (default): ask per PR, as before.
  `auto_after_ready`: post it without asking once the PR is ready (see above).
- Skip the deploy comment (and say why in the report) when: the repo is in
  `ci.deploy_excluded_repos`; `ci.deployed_label` is set and already on the PR; the head SHA equals
  `last_deploy_comment_sha` in the state file (one deploy comment per head SHA); or the poller's
  `no_services_affected` is `true` (a dependency-only PR; this needs `ci.no_services_check`, and
  without it just report that the PR looks dependency-only if you can tell).
- After posting, write `last_deploy_comment_sha` (the head SHA) to the state file.
- **A failed deploy**: on later passes read the comments that came after ours from the deploy bot
  (bot logins, or whoever replied) and report the reply verbatim-ish (a few lines). Never retry the
  comment blindly: a retry needs a new head SHA or a fix for what the reply says, or the user's yes.

## Environment lock (`ci.lock_label`, `ci.holder_label`)

Unset by default (off). Some deploy setups allow one PR per environment at a time and mark that with
labels.

1. When one of our PRs has `ci.lock_label` (our deploy is blocked behind someone else), find the PR
   holding the environment: the open PR in the same repo carrying `ci.holder_label`
   (`gh pr list --repo <o>/<r> --label "<holder_label>" --state open --json number,author,url,title`).
2. If the holder PR's author is **not** Self, tell that author once per lock: record
   `lock_notified_for: <holder PR url>` in our PR's state file and don't notify again for the same
   holder. Notify through the configured messaging only when a Slack integration is available and the
   people map (`<notes_repo>/github-slack-people.yml`, see `ax-pr-review-request`) has the author;
   otherwise just report it to the user. Message template: `ci.lock_notice_template` with
   `{holder_pr}`, `{our_pr}`, `{author}` placeholders; the default is
   `Hi <@{author}>, your PR {holder_pr} holds the deploy environment and {our_pr} is waiting for it.
   Could you /rollback or tell us roughly when it will be released? Thanks!`.
3. **Never notify about our own PRs' locks** (holder authored by Self): just report it.
4. When our PR no longer has `lock_label`, clear `lock_notified_for` and, if the deploy policy allows
   (see above, including the once-per-head rule, which a new head SHA resets), post the deploy comment
   again.

## Review reminders (`reminders`)

Unset by default (off). Config: `after_min`, `tz` (IANA name), `days` (e.g. `[Mon, Tue, Wed, Thu,
Fri]`), `hours` (`"09:00-19:00"`), `template`.

- Due when the PR is open and ready, still lacks its required approval (`review.decision` is not
  `APPROVED`, or the gate reports missing approvals), and at least `after_min` minutes have passed
  since the later of `review_request.at` and `last_reminder_at` in the state file.
- **Nothing goes out outside office hours**: check the current time in `reminders.tz` against `days`
  and `hours`; if outside, skip the reminder (it stays due and goes out in the next window).
- Reply **in the review-request thread** (`review_request.channel` + `review_request.ts` from the
  state file); with no `ts` recorded, don't post a new top-level message — report it instead.
- Re-tag only pending code owners who have **not** approved: the poller's `requested_reviewers` minus
  `approved_by`, resolved to Slack mentions through the people map first (skip `skip_review: true`,
  never use `not:` IDs), then the search logic from `ax-pr-review-request`. Template placeholders:
  `{pr}`, `{owners}`; the default is `Gentle reminder: could someone take a look at {pr}? Pending: {owners} Thanks!`.
- Write `last_reminder_at` afterwards. At most one reminder per `after_min`.

## Post-merge hooks (`on_merge`)

Unset by default (off). Run once when a PR is seen `MERGED`, before deleting its state file; every
sub-key is independent and optional.

- `jira_done_transition: true` — only if a `jira` block is configured: move the Jira key recorded
  for the PR (PRS.md `Jira` column, or its plan) to Done with the Jira tooling available; if the key
  is missing or the transition isn't offered from its current status, report that instead.
- `check_cmd` — a command template, with `{repo}`, `{number}`, `{jira}` placeholders, for any
  post-merge check (for example querying a dependency-alert state). Run it; on failure or an
  "unknown yet" result retry on later passes (the state file's `notes` records the attempts, at most
  5, at least 10 minutes apart; dependency graphs lag), and report the last output.
- `slack_thread: {channel, ts, template}` — post `template` (placeholders `{pr}`, `{repo}`,
  `{number}`, `{jira}`) as a reply in that thread, once per PR. Needs a Slack integration; otherwise
  report it. Never post to another channel.

## Superseded bot PRs (`supersedes`)

A PR row or its state file may carry `supersedes: [<repo>#<n> or URL>, ...]`: bot PRs (e.g. a
dependency bot) our PR makes redundant. The final report lists them under **can now be closed** once
our PR is merged (or ready, saying so). **Never** comment on, close, or otherwise touch them.

## Stop and cadence

A PR whose only remaining blockers are **human-only** — an approval owed by a person, a manual-merge
repo ready for the user, a decision only the user can make — needs no frequent polling. When *every*
open PR is in that state:

- stop looping and give the final report, or
- stretch the next wakeup to the next office-hours window (`reminders.tz`/`days`/`hours` when set,
  else a few hours) when waiting on approvals outside office hours; don't poll every few minutes
  overnight or at weekends.

Anything that can still change by itself (CI running, a bot review, a lock about to clear, a reminder
that comes due) keeps the normal short cadence.
