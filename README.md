# AINotes

A git-backed second brain for [Claude Code](https://claude.com/claude-code), for people who work
across many repositories at once. It keeps dated notes, plans, tasks, a PR ledger and reports in a
small **notes repo** inside each **workspace** (a folder holding related repos side by side), and
comes with a local viewer to browse it all.

## Contents

- [Quick start](#quick-start) — [install](#install) · [update](#update) · [uninstall](#uninstall)
- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Other ways to install](#other-ways-to-install) — [plugin](#claude-code-plugin) · [from a clone](#from-a-clone) · [install options](#install-options)
- [How it works](#how-it-works) — [layout](#workspace-layout) · [skills](#skills) · [agents](#agents) · [hooks](#hooks)
- [Tools](#tools)
- [Viewer](#viewer)
- [Development](#development) — [releasing](#releasing)
- [License](#license)

## Quick start

### Install

```bash
npx ainotes-viewer@latest install ~/projects/my-workspace   # install into a workspace
cd ~/projects/my-workspace && claude                         # then say: setup ainotes
npx ainotes-viewer@latest                                    # open the viewer
```

Say **yes** when the installer offers to schedule the agents snapshot (it fills the viewer's Agents
view), and always start `claude` from the workspace root.

### Update

```bash
npx ainotes-viewer@latest install --force ~/projects/my-workspace
```

This also upgrades an older install made from a clone; you can delete the clone afterwards.

### Uninstall

```bash
npx ainotes-viewer@latest install --uninstall ~/projects/my-workspace
```

Your notes repo and `.ai-notes/` are left untouched.

## What you get

- **Notes and plans**: `note: ...` / `plan: ...` become dated, tagged Markdown files, indexed by tag
  and domain.
- **Task workflow**: `ainotes-task` runs a change end to end: fresh worktree, a written plan, your
  approval, execution, an independent review. It never commits, pushes or opens a PR without asking.
- **PR ledger**: `PRS.md` tracks every PR you open. `check prs` reconciles it with GitHub;
  `babysit prs` keeps PRs moving (updates branches, reruns CI, handles review comments). It never
  merges.
- **Tasks and daily plans**: `TASKS.md` for work that spans sessions, `daily/YYYY-MM-DD.md` for a
  checklist you tick off by hand.
- **Reports**: weekly, monthly or quarterly reviews compiled from all of the above.
- **Slack review requests** (optional): ask for reviews, @mentioning pending code owners.
- **Viewer**: browse and edit every workspace's notes, tasks, PRs and running agents in the browser.

Workspaces stay fully separate — for example `~/work/` with Jira and Slack, `~/personal/`, and
`~/study/` with no Jira at all. Everything workspace-specific lives in that workspace's
`.ai-notes/config.yml`, so one toolkit serves them all.

## Requirements

| For | You need |
|---|---|
| The toolkit | Claude Code, `git`, the [GitHub CLI](https://cli.github.com/) (`gh`, authenticated), `jq`, `python3` |
| The viewer and `npx` | Node.js 20.19+ or 22.12+, and a Chromium-based browser (Chrome, Edge, Arc, Brave) |
| Optional | A Jira MCP connector (ticket creation) and a Slack MCP connector (review requests) |

GitHub is the only supported VCS today.

## Other ways to install

### Claude Code plugin

```text
/plugin marketplace add garrefa/ai-notes
/plugin install ainotes@ainotes
```

One install serves every workspace, and it works wherever you launch Claude inside one. Update with
`claude plugin update ainotes`. Skills and agents are namespaced (`ainotes:ainotes-setup`), but the
plain names and trigger phrases work too. The plugin doesn't install the [tools](#tools) into your
workspace or schedule the agents snapshot; the Tools section covers running them without an install.

### From a clone

```bash
git clone https://github.com/garrefa/ai-notes.git
./ai-notes/install.sh ~/projects/my-workspace
```

`npx ainotes-viewer install` runs this same script, so the flags below apply to both. To update,
`git pull` and re-run with `--force`.

### Install options

The installer copies the skills, agents, hooks, tools and templates into `<workspace>/.claude/` and
adds its hooks to `<workspace>/.claude/settings.json`, keeping everything else there.

| Flag | Effect |
|---|---|
| `--dry-run` | Show what would change, change nothing |
| `--force` | Overwrite existing toolkit files (this is how you update; local edits to them are lost) |
| `--no-schedule` | Don't ask about scheduling the agents snapshot (for scripts and CI) |
| `--uninstall` | Remove everything it installed, including a schedule it set up |

**Scheduling**: in an interactive terminal, the installer offers to run `tools/snapshot-agents.sh`
every 60 seconds — a launchd job on macOS, a crontab line elsewhere. Re-running replaces its own
entry instead of adding another. If you scheduled it yourself from a clone's path, point that job
at `<workspace>/.claude/tools/snapshot-agents.sh` before deleting the clone.

Older notes repos that keep their data under a `db/` folder are flattened automatically on install.

## How it works

### Workspace layout

```text
~/projects/my-workspace/          <- workspace root: wherever .ai-notes/ lives
├── .ai-notes/config.yml          <- per-workspace settings (see tools/config.example.yml)
├── notes/                        <- the notes repo (name set by notes_repo); its own git repo
│   ├── notes/  plans/  tasks/  daily/
│   ├── INDEX.md                  <- tag -> files
│   ├── PRS.md                    <- PR ledger
│   └── TASKS.md                  <- task ledger
├── api-gateway/                  <- your repos, cloned side by side
└── web-app/
```

Skills find the workspace the way git finds `.git`: they walk up from the current directory to the
nearest folder containing `.ai-notes/`, so a note written in `~/study/` never lands in your work
notes. The notes repo is a journal, so its commits go straight to `main`; code changes in your repos
always go through worktrees and your normal review.

### Skills

| Skill | Say | Does |
|---|---|---|
| `ainotes-setup` | "setup ainotes", "register new repos" | Creates or updates `.ai-notes/config.yml` and the notes repo |
| `ainotes-notes` | `note: ...`, `plan: ...` | Writes dated, tagged notes and plans; keeps `INDEX.md` current |
| `ainotes-task` | "work on X in `<repo>`" | Worktree → plan → approve → execute → review → asks before committing |
| `ainotes-tasks` | `new task: ...`, "what are my open tasks" | Cross-session task ledger |
| `ainotes-daily-plan` | "daily plan: ...", "`<task>` is done" | One day's checklist, checked off by hand |
| `ainotes-pr-tracker` | "check prs" | Reconciles `PRS.md` with GitHub |
| `ainotes-babysit-prs` | `/loop babysit prs` | Pushes open PRs toward merge; asks before any deploy comment; never merges |
| `ainotes-pr-review-request` | "ask for review on `<PR>`" | Posts a review request to Slack (optional) |
| `ainotes-report` | "weekly report", "work review" | Compiles a report for a date window |

### Agents

Routine bookkeeping and polling run on cheap Haiku agents; approvals, code changes, reviews and
anything user-facing stay on your main model.

| Agent | Role |
|---|---|
| `notetaker` | The only writer for notes, plans and their `INDEX.md` entries |
| `ledger-keeper` | The only writer for `PRS.md`, `TASKS.md`, task files and daily plans; runs `check-prs.sh` |
| `pr-poller` | Polls open PRs for `babysit prs`; may rerun a failed job or update a stale branch; never comments, merges or pushes |
| `notes-extractor` | Read-only: turns a date window of notes into compact JSON for reports |
| `daily-plan-tracker` | Read-only: looks up context for daily plan items |

### Hooks

| When | Script | Does |
|---|---|---|
| Session start | `session-start-task-prompt.sh` | Asks whether to track the session as a task |
| Session start | `detect-unregistered-repo.sh` | Suggests registering a repo missing from the config |
| After a `git clone` | `detect-repo-clone.sh` | Suggests registering the newly cloned repo |

All hooks do nothing outside an AINotes workspace.

## Tools

Plain scripts, no LLM needed. The installer puts them in `<workspace>/.claude/tools/`.

| Tool | Does |
|---|---|
| `snapshot-agents.sh` | Writes `AGENTS.json` (the Claude Code sessions and jobs in the workspace) for the viewer's Agents view. Needs `jq`; meant to run every 60 seconds (the installer can schedule it). |
| `check-prs.sh` | The mechanical part of "check prs": reconciles `PRS.md` with GitHub and commits. Needs `gh` and `jq`; safe to schedule. |
| `clean-merged-worktrees.sh` | Lists worktrees whose branches were merged (squash and rebase merges too); deletes them only with `--delete`. |
| `config.example.yml` | Every config key, with comments. |

Every script takes `--help`. Without installing anything, run the first two from inside a workspace
with `npx ainotes-viewer snapshot-agents` or `npx ainotes-viewer check-prs`. That's fine now and
then, but `npx` checks the registry on every run, so for a 60-second schedule use the installed copy
— or `npm install -g ainotes-viewer` once and schedule `ainotes-viewer snapshot-agents`.

## Viewer

Click **Add folder…** and pick a workspace's notes repo. Add as many as you like; switch between them
from the sidebar or the command palette (`Cmd/Ctrl+K`). Everything happens locally, in the browser:
it reads and writes the Markdown files directly and nothing leaves your machine.

- **Any folder works**: without `notes/` or `plans/`, every `.md` file under it is listed as a note,
  with the date and tag filters turned off.
- **Tasks**: colored status dots; changing a status updates both the task file and `TASKS.md`.
  Change colors, or which statuses count as closed, in **Settings**.
- **Filters**: a date range (last 7 days by default, or custom) and tags, for notes and PRs.
- **Library**: counts per item; drag to reorder. The order and your last selection are remembered.
- **Agents**: who's working, idle, or waiting on you. Empty until the agents snapshot is scheduled
  (see [Install options](#install-options)).
- **Pull requests**: the `PRS.md` ledger with CI, review and merge hints.
- **Version**: shown in **Settings**.

More detail in [`webapp/README.md`](webapp/README.md).

## Development

Run the viewer from source:

```bash
cd webapp && npm install
npm run dev                            # http://localhost:5173
npm run build && npm run preview       # production build, http://localhost:4173
```

### Releasing

The plugin and the npm package share one version and one [`CHANGELOG.md`](CHANGELOG.md)
([Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [semver](https://semver.org/)).

1. Add entries under `## [Unreleased]` as you go.
2. Run `tools/release.sh 0.2.0`. It bumps `.claude-plugin/plugin.json` and `webapp/package.json`,
   dates the changelog section, commits and tags. It never pushes.
3. Review, then `git push && git push origin v0.2.0`. The tag runs
   [`.github/workflows/release.yml`](.github/workflows/release.yml), which publishes
   `ainotes-viewer` to npm (needs a one-time `NPM_TOKEN` repo secret) and creates a GitHub Release.

Plugin users get it with `claude plugin update ainotes`; everyone else with the
[update command](#update).

## License

[MIT](LICENSE)
