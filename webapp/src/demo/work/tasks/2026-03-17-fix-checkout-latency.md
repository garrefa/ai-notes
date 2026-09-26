---
title: Fix the checkout latency regression
created: 2026-03-17
deadline: null
status: in-progress
domain: [payments, infra]
jira: [PAY-1231]
prs: ["northwind-demo/infra-terraform#219", "northwind-demo/payments-api#489"]
tags: [task, incident, latency]
links:
  - notes/2026-03-18-checkout-latency-spike-investigation.md
---

## Purpose
Bring checkout p99 back under 500 ms and keep batch jobs from starving the API's connection pool.

## Updates
- 2026-03-17: created after the first latency alert.
- 2026-03-18: root cause found (pool exhaustion); stopgap PR #219 opened, proper fix in PR #489.
