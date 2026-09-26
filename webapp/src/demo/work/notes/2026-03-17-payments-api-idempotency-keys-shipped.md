---
date: 2026-03-17
type: note
repo: payments-api
domain: [payments]
epic: PAY-1100
tags: [idempotency, api, shipped, epic:PAY-1100]
jira: PAY-1204
status: n/a
links:
  - plans/2026-03-16-payments-api-idempotency-keys.md
  - tasks/2026-03-16-ship-idempotency-keys.md
---

# Shipped: idempotency keys for POST /charges (PAY-1204)

Outcome note for `plans/2026-03-16-payments-api-idempotency-keys.md`.

## Result

- `Idempotency-Key` header is now accepted on `POST /charges` and `POST /refunds`.
- Keys are stored in Redis for 24 h with the response hash; a replay returns the stored response
  with `Idempotent-Replayed: true`.
- A replay with a different body returns `422 idempotency_key_reused`.
- Merged as payments-api PR #482 and deployed to production at 16:40 UTC behind the
  `idempotency_keys` flag (100% after 30 minutes with no errors).

## Deviations from the plan

- Dropped the Postgres fallback store. Redis persistence (AOF) is enough for a 24 h window, and the
  review agreed.

## Numbers after one day

| Metric | Value |
|---|---|
| Requests with a key | 61% |
| Replays served | 1,284 |
| Duplicate charges prevented | 37 |
