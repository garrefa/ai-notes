---
title: Ship idempotency keys for POST /charges
created: 2026-03-16
deadline: 2026-03-20
status: done
domain: [payments]
jira: [PAY-1204]
prs: ["northwind-demo/payments-api#482"]
tags: [task, idempotency]
links:
  - plans/2026-03-16-payments-api-idempotency-keys.md
---

## Purpose
Stop duplicate charges caused by client retries after timeouts.

## Updates
- 2026-03-16: created; plan approved.
- 2026-03-16: opened payments-api PR #482.
- 2026-03-17: merged, deployed, ramped to 100%.
- 2026-03-17: status → Done
