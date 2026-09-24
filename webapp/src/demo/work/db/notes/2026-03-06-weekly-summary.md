---
date: 2026-03-06
type: weekly-summary
domain: [payments, frontend, mobile]
epic: null
tags: [weekly-summary]
status: n/a
links: []
---

# Weekly summary

## Shipped

- web-checkout PR #1294: saved cards list is now keyboard accessible.
- mobile-app PR #871: fixed the cart badge count after removing the last item.

## In progress

- Idempotency keys for `POST /charges`: plan written, waiting on the Redis capacity check.
- Offline cart for mobile: spike done; looking fragile, may drop it.

## Next week

- Start idempotency keys.
- Architecture sync on payment events.
