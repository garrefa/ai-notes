- `ax-babysit-prs`: per-PR state file `<notes repo>/.state/babysit/<owner>-<repo>-<n>.json` keeps
  timers and once-per-head rules (deploy comment sha, review request thread, reminders, bot
  re-requests, `known_blocker`, which replaces `rerun_already`) across passes and sessions.
- `pr-poller` also returns each bot reviewer's latest review with its actionable review-body items
  (nitpicks, outside-diff notes), the head SHA, labels, review decision and, with `ci.gate_check`,
  the gate's unmet requirements ("needs 1 more review" instead of "CI failing").
- New optional config, all off by default: `review.bots`, `review.bot_rerequest`,
  `review.ready_label`, `merge.manual_repos`, `merge.queue_file`, `ci.gate_check`,
  `ci.deploy_policy`, `ci.deploy_excluded_repos`, `ci.deployed_label`, `ci.no_services_check`,
  `ci.lock_label`, `ci.holder_label`, `ci.lock_notice_template`, `reminders` (office hours),
  `on_merge`, `review_request.style`. Details in `skills/ax-babysit-prs/policies.md` and
  `tools/config.example.yml`.
- `ax-pr-review-request`: reads an optional `<notes repo>/github-slack-people.yml` first for Slack
  mentions (template in `templates/`), supports a one-line `short` style and records the posted
  message `ts` in the babysit state file.
- `ax-babysit-prs` lists `supersedes` bot PRs as "can now be closed" and stops or stretches its
  wakeup to office hours when only human-only blockers remain.
