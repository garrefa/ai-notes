# PR Tracker

Master ledger of every PR opened across this workspace's repos and its merge/close status. Kept
in place (not dated). See the `ainotes-pr-tracker` skill for how this file is maintained and how
"check prs" reconciles it against GitHub.

## Pending (open)

| PR | Repo | Opened | Jira | Last checked (UTC) |
|---|---|---|---|---|
| [#486](https://github.com/northwind-demo/payments-api/pull/486) | payments-api | 2026-03-12 | [PAY-1215](https://jira.example.com/browse/PAY-1215) | 2026-03-18 |
| [#489](https://github.com/northwind-demo/payments-api/pull/489) | payments-api | 2026-03-18 | [PAY-1231](https://jira.example.com/browse/PAY-1231) | 2026-03-18 |
| [#1310](https://github.com/northwind-demo/web-checkout/pull/1310) | web-checkout | 2026-03-18 | [PAY-1242](https://jira.example.com/browse/PAY-1242) | 2026-03-18 |
| [#219](https://github.com/northwind-demo/infra-terraform/pull/219) | infra-terraform | 2026-03-18 | [PAY-1231](https://jira.example.com/browse/PAY-1231) | 2026-03-18 |
| [#884](https://github.com/northwind-demo/mobile-app/pull/884) | mobile-app | 2026-03-09 | [PAY-1211](https://jira.example.com/browse/PAY-1211) | 2026-03-18 |

## Merged

| PR | Repo | Opened | Merged | Jira |
|---|---|---|---|---|
| [#482](https://github.com/northwind-demo/payments-api/pull/482) | payments-api | 2026-03-16 | 2026-03-17 | [PAY-1204](https://jira.example.com/browse/PAY-1204) |
| [#1294](https://github.com/northwind-demo/web-checkout/pull/1294) | web-checkout | 2026-03-03 | 2026-03-05 | [PAY-1188](https://jira.example.com/browse/PAY-1188) |
| [#871](https://github.com/northwind-demo/mobile-app/pull/871) | mobile-app | 2026-03-02 | 2026-03-04 | [PAY-1181](https://jira.example.com/browse/PAY-1181) |
| [#214](https://github.com/northwind-demo/infra-terraform/pull/214) | infra-terraform | 2026-03-10 | 2026-03-11 | — |

## Closed (not merged)

| PR | Repo | Opened | Closed | Jira |
|---|---|---|---|---|
| [#471](https://github.com/northwind-demo/payments-api/pull/471) | payments-api | 2026-03-02 | 2026-03-09 | — |

## Pending — Detail

_Last deep check: 2026-03-18 (automated, no AI; see tools/check-prs.sh). Regenerated wholesale each
run, not an accumulating log._

| PR | Title | Open for | Last commit | CI | Behind main? | Reviews | Pending code owners | Unresolved comments |
|---|---|---|---|---|---|---|---|---|
| [#486](https://github.com/northwind-demo/payments-api/pull/486) (PAY-1215) | feat(refunds): emit webhooks for refund status changes | 6d | 1d | 🟢 Passing | Yes | priya-dev (APPROVED), review-bot[bot] (COMMENTED) | — | 2 unresolved: review-bot: Consider a retry budget for webhook delivery; marco-ops: Can we log the webhook id? |
| [#489](https://github.com/northwind-demo/payments-api/pull/489) (PAY-1231) | fix(db): separate connection pool for batch jobs | 0d | 0d | 🟢 Passing | No | — | team:platform-owners | None |
| [#1310](https://github.com/northwind-demo/web-checkout/pull/1310) (PAY-1242) | feat(checkout): Apple Pay button (draft) | 0d | 0d | 🟡 Running — E2E (IN_PROGRESS), Lint (SUCCESS) | No | — | team:frontend-owners | None |
| [#219](https://github.com/northwind-demo/infra-terraform/pull/219) (PAY-1231) | chore(payments-api): raise db pool size to 30 | 0d | 0d | 🔴 Failing — terraform plan (FAILURE), tflint (SUCCESS) | No | marco-ops (CHANGES_REQUESTED) | marco-ops | 1 unresolved: marco-ops: Plan fails on the replica module, so bump both pools |
| [#884](https://github.com/northwind-demo/mobile-app/pull/884) (PAY-1211) | feat(cart): show saved-for-later items | 9d | 5d | 🟢 Passing | Conflicts — dirty | ana-mobile (APPROVED), leo-ios (CHANGES_REQUESTED) | — | 3 unresolved: leo-ios: Empty state is missing on iPad; leo-ios: Use the design-system list row; ana-mobile: Nit: rename the flag (+1 more) |
