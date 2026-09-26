# AINotes

A git-backed second brain for [Claude Code](https://claude.com/claude-code), built for people who work
across many repositories at once.

You organize your work into **workspaces**, each a folder holding related repos cloned side by side.
You can have as many workspaces as you like, each fully separate from the others:

```text
~/work/       <- your job: service repos, a notes repo, work Jira and Slack settings
~/personal/   <- side projects, with their own notes, tasks and PR ledger
~/study/      <- courses and experiments; plans and daily checklists, no Jira at all
```

In each workspace, AINotes adds a small **notes repo**, plus a set of Claude Code skills that write
to it as you work:

- **Notes and plans**: `note: ...` / `plan: ...` become dated, tagged Markdown files, indexed by tag
  and domain.
- **Task workflow**: `ainotes-task` runs a real change end to end. It creates a fresh worktree off the
  latest default branch, has a subagent write a plan, waits for your approval, records the plan,
  optionally opens a Jira ticket, executes, and runs an independent review. It never commits, pushes
  or opens a PR without asking.
- **PR ledger**: `PRS.md` tracks every PR you open across the workspace. `check prs` reconciles it
  against GitHub. `babysit prs` (under `/loop`) keeps PRs current with their base branch, reruns
  failed CI and handles review comments. It never merges.
- **Tasks and daily plans**: `TASKS.md` holds work that spans sessions. `daily/YYYY-MM-DD.md` is a
  checklist you tick off by hand.
- **Reports**: weekly, monthly or quarterly reviews compiled from everything above.
- **Slack review requests** (optional): post a review ask for your PRs, @mentioning pending code
  owners.
- **Viewer**: a local web app that browses and edits every workspace's notes, tasks and PRs, and
  switches between workspaces in one click. Run with `npx ainotes-viewer@latest` — no clone, no
  install (see [Viewer](#viewer)).

Everything workspace-specific (GitHub org, Jira project, Slack channel, repo → domain mapping) lives
in that workspace's `.ai-notes/config.yml`. The skills themselves never change, so one install
serves every workspace.

## Requirements

- Claude Code
- `git`, and the [GitHub CLI](https://cli.github.com/) (`gh`), authenticated
- `jq` and `python3` (used by the hooks and tools)
- For the viewer: Node.js 20.19+ or 22.12+ and a Chromium-based browser (Chrome, Edge, Arc, Brave)
- Optional: a Jira MCP connector (for ticket creation) and a Slack MCP connector (for review requests)

GitHub is the only supported VCS today.

## Install

Both options below install the **Claude Code toolkit** — the skills, agents and hooks that write to
your notes repo as you work. If all you want is to **browse an existing notes repo visually**, you
don't need either of them or a clone: skip straight to `npx ainotes-viewer@latest` in
[Viewer](#viewer).

### Option A: Claude Code plugin (recommended)

```text
/plugin marketplace add garrefa/ai-notes
/plugin install ainotes@ainotes
```

Skills, agents and hooks load from the plugin, so one install serves every workspace you have, and
they work wherever you launch Claude inside a workspace (the root or any repo in it). Plugin skills
and agents are namespaced (`ainotes:ainotes-setup`, `ainotes:notetaker`), but the plain names and
trigger phrases work too. To upgrade later, run `claude plugin update ainotes` (see
[Releasing](#releasing) for how versions are cut).

### Option B: copy into a workspace

```bash
git clone https://github.com/garrefa/ai-notes.git
./ai-notes/install.sh ~/projects/my-workspace          # --dry-run to preview, --force to overwrite
./ai-notes/install.sh --uninstall ~/projects/my-workspace
```

This copies the skills, agents, hooks, tools and templates into `<workspace>/.claude/` and merges the
hook wiring into `<workspace>/.claude/settings.json`, keeping whatever is already there. Choose this
if you want to commit the toolkit alongside a shared workspace or customize the skills in place.
Claude Code only reads `<workspace>/.claude/` when it starts at the workspace root, so in this mode
launch `claude` from the root, not from inside one of the repos. To upgrade, pull and re-run with
`--force` (this overwrites local edits to the toolkit's own files; your other files are untouched).

Run from a real terminal (not `--dry-run`), it also asks once whether to schedule
`tools/snapshot-agents.sh` to run every 60 seconds — needed for the [viewer](#viewer)'s Agents view
to have anything to show. Say yes and it sets up a per-user launchd job (macOS) or a crontab line
(everywhere else) for you; say no, or pass `--no-schedule` to skip the question outright (e.g. in a
script), and set it up yourself later however you like. `--uninstall` always removes it again, no
asking, if this script was the one that set it up.

### Then, in either case

```bash
cd ~/projects/my-workspace && claude
```

Then say **`setup ainotes`**. The `ainotes-setup` skill explains each setting as it asks about it,
writes `.ai-notes/config.yml`, can create the notes repo from `templates/notes-repo/`, and asks you to
tag each cloned repo with a domain (or ignore it). Repeat this in every workspace you want to track.

## How it fits together

```text
~/projects/my-workspace/          <- workspace root: wherever .ai-notes/ lives
├── .ai-notes/config.yml          <- per-workspace settings (see tools/config.example.yml)
├── notes/                        <- the notes repo (name set by notes_repo); its own git repo
│   ├── README.md  CLAUDE.md
│   ├── notes/  plans/  tasks/  daily/
│   ├── INDEX.md                  <- tag -> files
│   ├── PRS.md                    <- PR ledger
│   └── TASKS.md                  <- task ledger
├── api-gateway/                  <- your repos, cloned side by side
├── web-app/
└── mobile-app/
```

Skills find the workspace the same way git finds `.git`: they walk up from the current directory
until they reach a folder containing `.ai-notes/`. That's what keeps workspaces separate: a note
written while you're in `~/study/` never lands in your work notes.

Commits to the notes repo go straight to `main`: no branches or PRs, since it's a journal. Code
changes in your actual repos always go through worktrees and your normal review process.

### Hooks

| Event | Script | What it does |
|---|---|---|
| SessionStart | `session-start-task-prompt.sh` | Nudges Claude to ask whether to track this session as a task |
| SessionStart | `detect-unregistered-repo.sh` | If you're in a repo that isn't in `domain_taxonomy` or `ignored_repos`, suggests registering it |
| PostToolUse (Bash) | `detect-repo-clone.sh` | After a `git clone` lands a new repo in the workspace, suggests registering it |

All hooks exit silently outside an AINotes workspace.

### Skills

| Skill | Trigger | Purpose |
|---|---|---|
| `ainotes-setup` | "setup ainotes", "register new repos" | Create or update `.ai-notes/config.yml` and the notes repo |
| `ainotes-notes` | `note: ...`, `plan: ...` | Write dated, tagged notes and plans, and keep `INDEX.md` current |
| `ainotes-task` | "work on X in `<repo>`" | Worktree → plan → approve → execute → review → ask before committing |
| `ainotes-tasks` | `new task: ...`, "what are my open tasks" | Cross-session task ledger |
| `ainotes-daily-plan` | "daily plan: ...", "`<task>` is done" | One day's checklist, checked off by hand |
| `ainotes-pr-tracker` | "check prs" | Reconcile `PRS.md` with GitHub |
| `ainotes-babysit-prs` | `/loop babysit prs` | Push open PRs toward merge; always asks before a deploy comment; never merges |
| `ainotes-pr-review-request` | "ask for review on `<PR>`" | Post a review request to Slack (optional) |
| `ainotes-report` | "weekly report", "work review" | Compile a report for a date window |

Agents:

- `notetaker`: the single writer for notes, plans and their `INDEX.md` entries.
- `ledger-keeper`: the single writer for `PRS.md`, `TASKS.md`, task files and daily plans; also runs
  `check-prs.sh` for "check prs".
- `pr-poller`: polls open PRs for `babysit prs` (state, CI, comments); may rerun failed jobs once and
  update a branch that's behind, and never comments, merges or pushes.
- `notes-extractor`: read-only gatherer that turns a date window of notes into compact JSON for reports.
- `daily-plan-tracker`: read-only context lookups for daily plan items.

**Token use**: routine bookkeeping and polling run on Haiku agents. Approvals, code changes, reviews
and anything user-facing stay on your main model.

## Tools (no LLM needed)

Run these from a clone of this repo, from `<workspace>/.claude/tools/` if you used `install.sh`
(which can also schedule `snapshot-agents.sh` for you — see below), or via `npx ainotes-viewer` —
see the last bullet below. The plugin install keeps its copy in Claude Code's plugin cache, which
isn't a good path for cron.

- `tools/check-prs.sh [--org ORG] [--dry-run] [--verbose] [path/to/PRS.md]`: the mechanical part of
  "check prs" (reconcile, refresh status, commit), using only `gh` and `jq`. The org and the PRS.md
  path come from `.ai-notes/config.yml` when omitted. It's idempotent, so you can schedule it with
  cron, launchd or CI at whatever cadence you like.
- `tools/snapshot-agents.sh [--all] [--verbose] [path/to/AGENTS.json]`: writes `AGENTS.json`, a
  snapshot of the Claude Code sessions and background jobs working in the workspace (status, repo and
  worktree, last status line, tokens, linked PRs), read from `~/.claude/sessions/` and `~/.claude/jobs/`.
  It needs only `jq`. Schedule it every 60 seconds with launchd or cron to keep the viewer's Agents
  view current — `install.sh` offers to set this up for you (launchd on macOS, cron elsewhere); see
  Option B below. The file changes every run, so the notes-repo template keeps it out of git.
- `tools/clean-merged-worktrees.sh`: lists worktrees whose branches have been merged, including
  squash and rebase merges when `gh` is available. It's a dry run unless you pass `--delete`.
- `tools/config.example.yml`: every config key, with comments.
- **No clone, no `install.sh`**: `ainotes-viewer` (the same package `npx ainotes-viewer@latest`
  runs) bundles `check-prs.sh` and `snapshot-agents.sh` (not `clean-merged-worktrees.sh` or
  `release.sh` — see [`webapp/scripts/copy-tools.mjs`](webapp/scripts/copy-tools.mjs)) as
  subcommands: `ainotes-viewer snapshot-agents [args...]` / `ainotes-viewer check-prs [args...]`,
  run from inside the workspace so they can auto-discover it, same as running them from a clone.
  This is what makes the Agents view work for a pure-npm setup. For one-off or occasional use, `npx
  ainotes-viewer snapshot-agents` is fine; for the every-60-seconds schedule the Agents view wants,
  `npx` re-resolving the package against the registry on every invocation is unnecessary overhead
  (and a network dependency) — `npm install -g ainotes-viewer` once instead, and point
  cron/launchd at the installed `ainotes-viewer snapshot-agents`.

## Viewer

`webapp/` is a local web app for browsing and working with your notes repos: read and edit notes
and plans, see open tasks, pending PRs and the agents at work, and search or filter by tag. It reads and writes the Markdown
files directly through the browser's File System Access API. Nothing leaves your machine and there is
no server-side storage.

Run it without cloning anything — `npx` always resolves the latest published version, so there's
nothing to update by hand:

```bash
npx ainotes-viewer@latest
```

Or, from a clone of this repo, for development:

```bash
cd webapp
npm install
npm run dev        # then open the URL it prints (http://localhost:5173 by default)
```

Click **Add folder…** and pick a workspace's notes repo. Add as many as you
like, for example work, personal and study. The viewer remembers them, reopens the last one you used,
and switches between them from the switcher at the top of the sidebar or the command palette, with no
re-picking.

- **Task statuses**: every task shows a colored dot for its status. The Tasks view filters by status,
  and changing a task's status in the detail pane updates both the task file and `TASKS.md`.
  Backlog, in progress, done and dropped have built-in colors, and any other status shows in gray.
  Use **Settings** to change a status's color or mark it as closed. These viewer preferences are
  stored in your browser; the statuses the skills use are defined in `task_statuses` in
  `.ai-notes/config.yml`.
- **Date range**: a collapsible filter for notes and PRs: the *Last N days* (the default, 7 days
  counting today), or a *Custom* range picked with From and To dates. **Reset** goes back to the last
  7 days. It and the Tags section fold away; when folded, the header still shows the active range or
  tag.
- **Library**: each item shows a count (notes, open tasks, pending PRs, running agents). Drag the
  items into the order you like (the grip appears after the count on hover), or move the focused
  one with Alt+↑/↓. The order is stored in your browser. So is the last item you selected — a
  refresh or a new tab reopens it instead of always starting from all notes.
- **Agents**: lists the Claude Code agents working in the workspace, grouped by status: *Needs you*
  (waiting on your reply, highlighted and counted in the Library), *Working*, *Idle* and *Stopped*. The detail pane shows the agent's last
  status line, repo, worktree, tokens and linked PRs, which open in the Pull requests view. It reads
  `AGENTS.json` from `tools/snapshot-agents.sh` and updates whenever that file changes. Empty if
  nothing is running that script on a schedule — see the note about `npx` in
  [Tools](#tools-no-llm-needed) above.
- **Permissions**: if the browser drops a folder's permission, click **Grant access** to restore it.
- **Version**: the running version is shown in **Settings**. `npx ainotes-viewer@latest` always runs
  the newest one; see [Releasing](#releasing) for how a version is cut.
- **Missing folders**: a folder that was moved or deleted shows as *Missing*, with Locate… and
  Remove options, instead of blocking the app.

For a static build, run `npm run build && npm run preview` (http://localhost:4173). See [`webapp/README.md`](webapp/README.md)
for details.

## Releasing

The plugin and the viewer are versioned and released together, as one number, so "what version am I
on" has one answer everywhere:

- **Single version, single history**: [`CHANGELOG.md`](CHANGELOG.md) is the one changelog for the
  whole toolkit ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format,
  [semver](https://semver.org/)). `.claude-plugin/plugin.json`'s `version` and
  `webapp/package.json`'s `version` are always the same number.
- **Cutting a release**: add bullets to `CHANGELOG.md`'s `## [Unreleased]` section as you go, then
  run `tools/release.sh <version>` (e.g. `tools/release.sh 0.2.0`). It bumps both `version` fields,
  turns `[Unreleased]` into a dated `[0.2.0]` section with a fresh empty `[Unreleased]` above it,
  commits `Release v0.2.0`, and tags it. Nothing is pushed automatically — review the commit, then
  `git push && git push origin v0.2.0`.
- **What the tag triggers**: pushing a `vX.Y.Z` tag runs
  [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds `webapp/`, publishes
  it to npm as `ainotes-viewer`, and opens a GitHub Release whose body is that version's CHANGELOG
  section. That workflow needs a one-time `NPM_TOKEN` repo secret (see the comment at the top of the
  workflow file).
- **How each half updates for users**: the plugin marketplace entry tracks this repo's default
  branch (no `ref`/`sha` pin), so `claude plugin update ainotes` (or `/plugin marketplace update
  ainotes` in a session) fetches whatever was last released, and `claude plugin list` shows the
  installed version, both read from `plugin.json`. The viewer updates by running
  `npx ainotes-viewer@latest` again, which always resolves to the newest published version (pin an
  older one with `npx ainotes-viewer@0.1.0`).

## License

[MIT](LICENSE)
