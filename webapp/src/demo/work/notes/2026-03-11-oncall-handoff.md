---
date: 2026-03-11
type: note
domain: [infra, team]
epic: null
tags: [oncall, handoff]
status: n/a
links: []
---

# On-call handoff (week 10)

Quiet week: 3 pages, none customer-facing.

- **Mon 02:14:** `web-checkout` 5xx alert. A bad CDN config push, rolled back by the platform team.
- **Wed 11:30:** Disk usage on `payments-db-replica-2` at 85%. Old WAL files; cleaned up. Needs a
  retention fix (ticket PAY-1219).
- **Thu 18:05:** Stripe webhook retries piling up. A third-party slowdown, cleared on its own after
  20 minutes.

Watch next week: the `settlement-export` job moves to 09:00 UTC.
