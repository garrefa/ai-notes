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
  tasks, PRs and agents across one or more notes repos. A folder without the notes-repo layout
  still opens: every `.md` file in it is listed as a note. The release number shows at the bottom
  of the sidebar, and open tabs are told when a newer version is deployed, by number.
- The `ainotes-viewer` npm package (`webapp/`): `npx ainotes-viewer@latest` runs the viewer with
  no clone, and it bundles the whole toolkit, so `npx ainotes-viewer install <workspace>` installs
  it too — including a `run-viewer.sh` at the workspace root and an optional launchd/cron schedule
  for `snapshot-agents.sh`. `snapshot-agents` and `check-prs` also run as subcommands. Needs
  Node.js 20.19+ or 22.12+.
- The notes repo keeps its data at the repo root; installing over an older repo that still uses a
  `db/` folder moves it up automatically.

[Unreleased]: https://github.com/garrefa/ai-notes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/garrefa/ai-notes/releases/tag/v0.1.0
