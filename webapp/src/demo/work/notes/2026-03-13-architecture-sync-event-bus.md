---
date: 2026-03-13
type: meeting
domain: [payments, architecture]
epic: null
tags: [architecture, events, kafka, meeting]
status: n/a
links: []
---

# Architecture sync: moving payment events to the event bus

## Context

Today `payments-api` calls `ledger-service` and `notifications` synchronously after every charge.
A slow `notifications` call adds latency to checkout and has caused two incidents this quarter.

## Options discussed

1. **Keep sync calls, add timeouts.** Cheapest, but doesn't remove the coupling.
2. **Outbox table + relay to Kafka.** Guarantees delivery with the charge transaction. Needs a relay
   worker.
3. **Publish straight to Kafka after commit.** Simple, but events can be lost if the pod dies between
   commit and publish.

## Decision

Go with option 2 (transactional outbox). An ADR draft is due next week; the ledger team will
consume `payment.charge.succeeded` first.

## Open questions

- Event schema versioning: Avro or JSON Schema? The platform team prefers Avro.
- Who owns the relay worker on-call?
