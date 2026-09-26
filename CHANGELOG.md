# Changelog

All notable changes to ainotes — the Claude Code plugin (`.claude-plugin/`, `skills/`, `agents/`,
`hooks/`, `tools/`) and the viewer (`webapp/`) — are documented here. Both halves of the toolkit
share one version number, bumped together by `tools/release.sh`; see the "Releasing" section of the
[README](README.md#releasing) for how a release is cut.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-26

Baseline release. Established the current shape of the toolkit:

- The `ainotes` Claude Code plugin — `ainotes-task`, `ainotes-notes`, `ainotes-pr-tracker`,
  `ainotes-babysit-prs`, `ainotes-report`, `ainotes-daily-plan`, `ainotes-tasks`,
  `ainotes-pr-review-request` and `ainotes-setup` skills, their supporting agents and hooks, and the
  `tools/` scripts that run without an LLM (`check-prs.sh`, `snapshot-agents.sh`,
  `clean-merged-worktrees.sh`). Installable via the Claude Code plugin marketplace or vendored with
  `install.sh`.
- The `webapp/` viewer — a local, file-system-backed app for browsing and editing notes, plans,
  tasks, PRs and agents across one or more notes repos, run with `npm run dev` from a clone.
- A published `ainotes-viewer` npm package (`webapp/`), runnable with `npx ainotes-viewer@latest`
  without cloning the repo, and an in-app version label in Settings.

[Unreleased]: https://github.com/garrefa/ai-notes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.1.0
