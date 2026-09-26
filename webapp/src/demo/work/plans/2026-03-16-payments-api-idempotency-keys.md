---
date: 2026-03-16
type: plan
repo: payments-api
domain: [payments]
epic: PAY-1100
tags: [idempotency, api, epic:PAY-1100]
jira: PAY-1204
worktree: payments-api/.claude/worktrees/PAY-1204-idempotency-keys
status: done
links:
  - notes/2026-03-17-payments-api-idempotency-keys-shipped.md
---

# Plan: idempotency keys for POST /charges

## Task

Let clients retry `POST /charges` and `POST /refunds` safely by sending an `Idempotency-Key` header,
so a network timeout never turns into a double charge.

## Approach

1. Add an `IdempotencyFilter` that runs before the charge controller.
2. On a new key: lock it in Redis (`SET NX`, 60 s), run the request, and store
   `{status, body, request_hash}` for 24 h.
3. On a seen key with the same request hash: return the stored response with
   `Idempotent-Replayed: true`.
4. On a seen key with a different hash: `422 idempotency_key_reused`.
5. While the key is locked by an in-flight request: `409 request_in_progress`.

## Files

- `src/main/java/.../idempotency/IdempotencyFilter.java` (new)
- `src/main/java/.../idempotency/IdempotencyStore.java` (new, Redis-backed)
- `src/main/resources/application.yml`: `idempotency.ttl`, feature flag
- `docs/api/charges.md`: document the header

## Tests

- Unit: store hit, miss, hash mismatch, lock contention.
- Integration: two concurrent requests with the same key produce one charge.

## Rollout

Behind the `idempotency_keys` flag: 10% for 30 minutes, then 100%.
