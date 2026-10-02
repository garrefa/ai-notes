---
name: ainotes-dm-pr-review
description: Headless Claude code reviews of the GitHub PRs waiting on your review, posted as you. `tools/check-pending-pr-reviews --review` lists the PRs requesting your review directly (gh only, $0 when nothing is pending) and runs `tools/dm-pr-review.sh review` on each. That runs Claude Code's `/code-review` (default `high`, on Opus) against a private checkout, then approves with the review summary on zero findings or leaves a non-blocking inline COMMENT review. PRs already reviewed at their current commit, or approved by you there, are skipped. A monthly USD cap is enforced, every review's cost and tokens are logged, and each review is filed as a note via ainotes-review-notes. Trigger on "review my pending PRs", "review <PR>", "dry-run review <PR>", "review spend", "review status".
---

# PR auto-review (ainotes-dm-pr-review)

Turns "what's waiting on my review" into reviews that are actually done, without a model running on
a schedule. The queue check is plain `gh` (no LLM, $0). Claude only starts when a listed PR needs a
review. Distinct from `ainotes-review-inbox`, which summarizes and prioritizes the same queue but
never reviews or posts anything.

## How it works

```
tools/check-pending-pr-reviews --review       # gh only: PRs requesting your review directly, minus
  │                                     # dependabot[bot], stale (5+ days) and already approved;
  │                                     # least recently updated first. Empty list → Claude never starts.
  └─ per PR: tools/dm-pr-review.sh review <url>
       ├─ skip if closed/merged, approved by you at head, or already reviewed by us at head
       ├─ stop (exit 3) if < $1 is left in the monthly budget
       ├─ private clone cache → detached worktree at the PR head (never your own checkouts)
       ├─ claude -p --model <review_model> --max-budget-usd min(per-review cap, remaining)
       │    → /code-review <review.level>; read-only tools, no MCP; structured output
       │      {summary, key_changes, risk, follow_ups, findings[]}
       ├─ zero findings → gh pr review --approve (summary as the body)
       │  findings      → inline COMMENT review (falls back to body-only if GitHub rejects a line)
       ├─ pr-reviews-ledger.jsonl gets one line (PR, SHA, result, cost_usd, tokens); state.json records the SHA
       └─ review JSON piped to tools/review-note.sh (ainotes-review-notes) → <notes_repo>/reviews/
```

- **Settings:** the `dm_pr_review:` section of the ainotes config (`<notes repo>/.config.yml`):
  `self_github_login` (default: `gh api user`), `review_model` (opus), `review_level` (high),
  `per_review_budget_usd` (8) and `monthly_budget_usd` (100). Every key is optional.
- **Ledger:** `<notes repo>/pr-reviews-ledger.jsonl`, git-tracked. The reviewer commits it after
  every recorded call, and only it.
- **Local state:** `<notes repo>/.state/dm-pr-review/` (gitignored, created by install). It holds
  `state.json`, `review.log`, and `repos/` and `run/` (clone cache and temporary worktrees).
- **Budget:** every model call counts, dry runs included. Each review's `--max-budget-usd` is
  min(`per_review_budget_usd`, what's left this month), so the cap can't be overrun.
- **Filters** on `check-pending-pr-reviews` decide what gets reviewed: `--include-teams`,
  `--include-stale`, `--include-approved`, `--include-dependabot`, `--no-drafts`, `--no-bots`.
  The default org is `vcs.org`.

## Operations

Run from anywhere in the workspace. `T=<workspace>/.claude/tools` (or the plugin's `tools/`).

| Ask | Do |
|---|---|
| "what's pending my review" (list only) | `$T/check-pending-pr-reviews`; add `--json` for raw data |
| "review my pending PRs" | Show the `$T/check-pending-pr-reviews` listing first and confirm which PRs will be reviewed and posted to. Then run `$T/check-pending-pr-reviews --review`, or `--review-dry-run` to post nothing. |
| "review <PR>" | `$T/dm-pr-review.sh review <url>` |
| "dry-run review <PR>" | `$T/dm-pr-review.sh dry-run <url>`: real review, nothing posted, cost counts |
| "review spend [month]" | `$T/dm-pr-review.sh spend [YYYY-MM]` |
| "review status" | `$T/dm-pr-review.sh status` |
| change the cap / model / level | edit the `dm_pr_review:` section of `<notes repo>/.config.yml` |

Scheduling is optional and safe: run `check-pending-pr-reviews --review` from cron or launchd. With
nothing pending it costs $0.

## What this skill will never do

- Post anything with an automation tag. Reviews read as written by you, so only run `--review` on
  PRs you're comfortable approving or commenting on in your own name.
- Let the reviewer model write. It has no Edit/Write, no `gh pr review/comment/merge`, no
  `gh api`, no push and no MCP servers. Only the script publishes, using the model's structured
  output. PR content is treated as untrusted data in the prompt.
- Review a PR again at a commit it already reviewed, or go past the monthly budget.
- Merge, request changes (blocking), or touch your own checkouts.
