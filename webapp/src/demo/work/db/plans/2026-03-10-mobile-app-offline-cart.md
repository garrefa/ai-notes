---
date: 2026-03-10
type: plan
repo: mobile-app
domain: [mobile]
epic: null
tags: [offline, cart, spike]
status: dropped
links: []
---

# Plan: offline cart for the mobile app

## Task

Let users add items to their cart without a connection and sync when they're back online.

## Why it was dropped

The spike showed that price and stock changes during the offline window make the sync logic much
bigger than expected (conflict screens, partial failures). Product agreed to revisit it next quarter
with a smaller scope: show the cached cart read-only while offline.
