---
name: ainotes-pr-review-request
description: Post a kind review-request message to Slack (channel per `slack.pr_review_channel` in `.ai-notes/config.yml`; the skill is disabled when that key is unset) for one or more specified PRs — a short description of what each PR does, plus @mentions for its pending code owners. Trigger on "ask for review(s) on <PR(s)>", "request review for <PR>", or "send a slack message asking for review on <PR>".
---

# PR Review Request (ainotes-pr-review-request)

Posts a friendly ask-for-review message to Slack, one per PR, in the channel this workspace has
configured for this. Always that channel; never ask which channel.

(Read `slack.pr_review_channel`, `vcs.org`, and `org_name` from the workspace's `.ai-notes/config.yml`
— see `ainotes-notes` for the config-discovery rule — before doing anything else. Below, `<channel>`,
`<vcs.org>`, and `<org_name>` stand for those values, e.g. `#pr-review`, `acme`, and `Acme`.)

**If `slack.pr_review_channel` is null or absent, stop here** — post nothing, and tell the user this
skill is disabled until a channel is configured: set `slack.pr_review_channel: "#<channel-name>"` in
`<workspace-root>/.ai-notes/config.yml` (by hand, or by running the `ainotes-setup` skill), then ask
again. This skill also needs a Slack integration (MCP tools such as `slack_search_channels`,
`slack_search_users`, and a send-message tool); if none is available, say so and stop.

## Inputs

The user names one or more PRs (e.g. "web-app #4815", "api-gateway #651 and #652", or just PR
numbers if the repo is obvious from context). If the repo isn't clear for a given number, ask.

## Steps (per PR, independent PRs can run in parallel)

1. **Channel**: resolve `<channel>`'s ID once via `slack_search_channels` (cache it in the reply for
   reuse within the same run — no need to re-resolve per PR).
2. **Description**: `gh pr view <n> --repo <vcs.org>/<repo> --json title,body,url` — write a short
   (2-4 sentence) summary of what the PR does from the title + body's Summary section. Don't just
   restate the title; say what changed and why if the body explains it.
3. **Pending code owners**: `gh api repos/<vcs.org>/<repo>/pulls/<n> --jq '{requested_reviewers: [.requested_reviewers[].login], requested_teams: [.requested_teams[].slug]}'`
   — these are the people/teams still owed a review. If `requested_reviewers` is empty but a team is
   still requested, name the team instead of digging up its members.
4. **Resolve each pending reviewer's Slack identity** (GitHub login → Slack mention):
   - Try `slack_search_users` with the raw GitHub login first (some Slack display names match it).
   - If that misses, get the real name from GitHub: `gh api users/<login> --jq '{name}'`, then
     `slack_search_users` with that full name.
   - **Confidence check before tagging**: only use an actual `<@USERID>` mention when the match is
     solid — the returned name is a clear match for the GitHub real name (allowing for common
     nickname patterns, e.g. "Bill" for "William"; a translated or loosely similar surname is NOT a
     solid match, and a bare first-name-only hit against a common name is NOT solid). When it's not
     solid, write the person's real name plus `(GitHub: <login>)` as plain text instead of an
     `@mention` — never guess-tag someone in a public channel. List which ones you couldn't
     confidently resolve when reporting back to the user.
5. **Compose and send** one Slack message per PR to `<channel>`:
   ```
   Hey <org_name> team :wave: Could you please review [<repo> #<n> — <title>](<url>)?

   **What it does:** <2-4 sentence summary>

   **Pending code owners:** <@USERID> <@USERID> ... <plain-text names for unresolved ones>

   Thanks in advance! 🙏
   ```
   (Drop `<org_name> ` — just "Hey team" — when `org_name` isn't set in config.) Adapt the
   formatting to whatever the Slack tool expects — for Slack mrkdwn that means links as
   `<url|text>` and bold as `*bold*` rather than the Markdown shown above. Send as separate
   top-level messages (not a thread) — one per PR, even when several PRs were requested together
   in one ask.
6. **Report back**: the Slack message link for each PR sent, and call out explicitly any reviewer
   you couldn't confidently resolve to a Slack account (so the user can tag them manually if
   needed).

## What this skill will NOT do

- Post anywhere other than the configured channel — if the user wants a different channel for a
  one-off, that's a different, explicit ask, not this skill overriding its config.
- Tag a Slack user on anything less than a solid name match — see step 4.
- Merge, approve, or otherwise act on the PR itself — this only asks for review.
