---
date: 2026-03-16
type: meeting
domain: [team]
epic: null
tags: [retro, meeting, process]
status: n/a
links: []
---

# Sprint 5 retro

Attendees: payments squad (6), plus the mobile lead.

## Went well

- Idempotency keys landed a day early, with a clean plan-then-review loop.
- Pairing on the flaky checkout E2E tests cut the flake rate from 12% to 3%.

## Didn't go well

- Two PRs waited more than three days for review.
- The staging database was down for half a day during the credentials rotation dry run.

## Actions

- [ ] Post review requests in #payments-reviews with a named owner (me, starting this sprint).
- [ ] Write a runbook for the staging credentials rotation before the real one.
- [x] Move retro to Monday mornings.
