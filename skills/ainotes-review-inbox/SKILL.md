---
name: ainotes-review-inbox
description: Finds every open PR across the configured GitHub org (`vcs.org` in .config.yml) where your review is requested — not just PRs in repos checked out in this workspace — summarizes each one, flags which are stale, and assigns a priority (high/medium/low). Triage is cheap: a Haiku agent does the judgment calls, not the main thread. Trigger with "check my pr review queue", "what needs my review", "review inbox", or "pending my review". Plays well with `/loop` for a self-paced recurring check.
---

# Review Inbox

Answers "what's pending my review, and what actually matters right now" across every repo in the
org — not just the ones cloned into this workspace, since a GitHub review request can land
anywhere. Distinct from `ainotes-pr-tracker` / `ainotes-babysit-prs`, which track PRs *you*
opened; this is about PRs *someone else* opened that are waiting on you.

## Scope: which PRs

Org-wide, via `vcs.org` in `.config.yml` (see `ainotes-notes` for the config-discovery
rule) — every open PR with your review requested, regardless of repo. If the user names a
specific repo ("what's pending my review in react-web"), scope to just that repo instead.

## One pass

1. **Gather — no LLM.** Run `tools/review-inbox.sh` from this plugin's root (works from any
   directory once `.config.yml` is discoverable, or pass `--org`). It does one `gh search
   prs --review-requested=@me` call plus a handful of batched GraphQL lookups (not one REST call
   per PR — see the script's header comment), and computes every objective fact itself: age in
   days, days since last update, a `stale` flag (default threshold 5 days since last update,
   `--stale-days` to change it), size (additions/deletions/changed files), review decision, CI
   state, labels, and bot authorship. It prints one JSON array, one object per PR — `[]` if
   nothing's pending. If it's `[]`, report that and stop; nothing to triage.

2. **Triage in parallel batches — this is the only part that costs an LLM call.** Split the array
   into batches of ~25 PRs. Spawn one `review-inbox-poller` agent per batch (named
   `ainotes:review-inbox-poller` when AINotes is installed as a plugin; if neither name is
   available, spawn a general-purpose agent with `model: haiku` and give it the contents of
   `<skill base dir>/../../agents/review-inbox-poller.md` as its instructions) — all batches in
   **one message** so they run concurrently, not sequentially. Each agent call is pure
   text-in/text-out (no tool calls, no gh access) over the batch you hand it, and returns one YAML
   record per PR: `{pr: <repo>#<number>, summary, priority: high|medium|low}`. Merge each record
   back onto its original object by `repo`+`number`.

3. **Report**, grouped by priority (high first), each group sorted stale-first then by
   `days_since_update` descending:
   - **High** and **Medium** — one line per PR: `[#<number>](<url>) <repo> — <summary>`, with a
     `STALE <days_since_update>d` tag when `stale` is true and the author noted when
     `is_bot_author` is true.
   - **Low** — don't list every one (bot dependency bumps dominate this bucket and aren't worth
     the scroll); collapse to counts, e.g. "38 dependency bumps, 6 already approved & green, 4
     drafts". Offer to list them in full if the user asks.

   Lead with totals: `<N> pending review, <M> stale, <H> high / <Med> medium / <L> low priority`.

## Looping

Plays well with `/loop check my pr review queue` for a self-paced recurring check. Review queues
don't change second-to-second — schedule the next pass on the order of 20–30 minutes, not
seconds. Deliberately stateless across passes (no ledger, unlike `ainotes-pr-tracker`'s PRS.md):
every pass reports the live, current state, so a PR that just went stale or was just
re-requested resurfaces rather than being silently suppressed by a "already reported" filter.

## What this skill will never do

Comment on, review, approve, merge, or otherwise touch any of these PRs — it only reads and
reports. Actually reviewing them stays on the user.
