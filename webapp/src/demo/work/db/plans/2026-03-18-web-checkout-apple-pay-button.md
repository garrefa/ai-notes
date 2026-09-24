---
date: 2026-03-18
type: plan
repo: web-checkout
domain: [frontend, payments]
epic: PAY-1150
tags: [apple-pay, checkout, epic:PAY-1150]
jira: PAY-1242
worktree: web-checkout/.claude/worktrees/PAY-1242-apple-pay
status: planned
links:
  - tasks/2026-03-18-apple-pay-checkout.md
---

# Plan: Apple Pay button on the checkout page

## Task

Show an Apple Pay button above the card form on Safari (macOS and iOS) when the device can pay, and
fall back to the card form everywhere else.

## Approach

1. Add a `usePaymentRequestAvailability()` hook that checks `ApplePaySession.canMakePayments()`.
2. Render `<ApplePayButton />` from the design system when available.
3. On click, start an `ApplePaySession`, validate the merchant via `POST /apple-pay/session`
   (new payments-api endpoint, separate PR), then submit the token to `POST /charges`.
4. Track `checkout_apple_pay_shown` and `checkout_apple_pay_completed` events.

## Open questions

- Do we need the merchant domain verification file on the CDN or on the app origin? Ask platform.
- Should the button replace "Pay now" when available, or sit above it? Design says above.

## Tests

- Component tests for available and unavailable states.
- Manual test on a real iPhone with the sandbox merchant.
