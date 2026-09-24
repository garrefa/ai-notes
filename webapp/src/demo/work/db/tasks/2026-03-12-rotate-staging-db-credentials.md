---
title: Rotate the staging database credentials
created: 2026-03-12
deadline: 2026-03-27
status: backlog
domain: [infra]
jira: [PAY-1220]
prs: []
tags: [task, security, infra]
links: []
---

## Purpose
The staging database password is 14 months old and was shared in a Slack thread. Rotate it and move
every consumer to secrets-manager references.

## Updates
- 2026-03-12: created.
- 2026-03-16: dry run took staging down for half a day; writing a runbook first (retro action).
