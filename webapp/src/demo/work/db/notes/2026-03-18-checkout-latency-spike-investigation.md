---
date: 2026-03-18
type: note
repo: payments-api
domain: [payments, infra]
epic: PAY-1100
tags: [incident, latency, postgres, epic:PAY-1100]
jira: PAY-1231
status: n/a
links:
  - tasks/2026-03-17-fix-checkout-latency.md
  - notes/2026-03-11-oncall-handoff.md
---

# Checkout p99 latency spike: connection pool exhaustion

Checkout p99 jumped from ~420 ms to 2.8 s between 09:10 and 09:55 UTC. Error rate stayed flat, so
customers saw slow pages, not failures.

## What we found

- `payments-api` pods were waiting on the Postgres connection pool: `hikaricp_pending_threads`
  peaked at 38 against a pool size of 20.
- The trigger was the nightly `settlement-export` job, which was rescheduled last week to 09:00 UTC
  and shares the same database user and pool.
- No slow queries on their own. Every query was fast once it got a connection.

## Mitigation (done)

- Moved `settlement-export` back to 03:00 UTC.
- Raised the pool to 30 on `payments-api` as a stopgap (infra-terraform PR #219).

## Follow-ups

- [ ] Give batch jobs their own database user and pool (payments-api PR #489).
- [ ] Alert on `hikaricp_pending_threads > 10` for 5 minutes.
- [ ] Add the incident to the next retro agenda.
