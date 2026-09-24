# ai-notes

A git-backed second brain for [Claude Code](https://claude.com/claude-code), built for people who work
across many repositories at once.

You keep a **workspace**: one folder with all your repos cloned side by side. ai-notes adds a small
**notes repo** to that folder and a set of Claude Code skills that write to it as you work:

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

Everything organization-specific (GitHub org, Jira project, Slack channel, repo → domain mapping)
lives in one file per workspace, `.ai-notes/config.yml`. The skills themselves never change.

## Requirements

- Claude Code
- `git`, and the [GitHub CLI](https://cli.github.com/) (`gh`), authenticated
- `jq` and `python3` (used by the hooks and tools)
- Optional: a Jira MCP connector (for ticket creation) and a Slack MCP connector (for review requests)

GitHub is the only supported VCS today.

## Install

### Option A: Claude Code plugin (recommended)

```text
/plugin marketplace add garrefa/ai-notes
/plugin install ainotes@ainotes
```

Skills, agents and hooks load from the plugin, so one install serves every workspace you have, and
they work wherever you launch Claude inside a workspace (the root or any repo in it). Plugin skills
and agents are namespaced (`ainotes:ainotes-setup`, `ainotes:notetaker`), but the plain names and
trigger phrases work too.

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

### Then, in either case

```bash
cd ~/projects/my-workspace && claude
```

Then say **`setup ainotes`**. The `ainotes-setup` skill explains each setting as it asks about it,
writes `.ai-notes/config.yml`, can create the notes repo from `templates/notes-repo/`, and asks you to
tag each cloned repo with a domain (or ignore it).

## How it fits together

```text
~/projects/my-workspace/          <- workspace root: wherever .ai-notes/ lives
├── .ai-notes/config.yml          <- per-workspace settings (see tools/config.example.yml)
├── notes/                        <- the notes repo (name set by notes_repo); its own git repo
│   ├── notes/  plans/  tasks/  daily/
│   ├── INDEX.md                  <- tag -> files
│   ├── PRS.md                    <- PR ledger
│   └── TASKS.md                  <- task ledger
├── api-gateway/                  <- your repos, cloned side by side
├── web-app/
└── mobile-app/
```

Skills find the workspace the same way git finds `.git`: they walk up from the current directory
until they reach a folder containing `.ai-notes/`. So you can have several independent workspaces
(work, personal, a client) served by one install, each with its own config and notes repo.

Commits to the notes repo go straight to `main`: no branches or PRs, since it's a journal. Code
changes in your actual repos always go through worktrees and your normal review process.

### Hooks

| Event | Script | What it does |
|---|---|---|
| SessionStart | `session-start-task-prompt.sh` | Nudges Claude to ask whether to track this session as a task |
| SessionStart | `detect-unregistered-repo.sh` | If you're in a repo that isn't in `domain_taxonomy` or `ignored_repos`, suggests registering it |
| PostToolUse (Bash) | `detect-repo-clone.sh` | After a `git clone` lands a new repo in the workspace, suggests registering it |

All hooks exit silently outside an ai-notes workspace.

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

Agents: `notetaker` (cheap, convention-following notes bookkeeping) and `daily-plan-tracker`
(read-only context lookups for daily plan items).

## Tools (no LLM needed)

Run these from a clone of this repo, or from `<workspace>/.claude/tools/` if you used `install.sh`.
The plugin install keeps its copy in Claude Code's plugin cache, which isn't a good path for cron.

- `tools/check-prs.sh [--org ORG] [--dry-run] [--verbose] [path/to/PRS.md]`: the mechanical part of
  "check prs" (reconcile, refresh status, commit), using only `gh` and `jq`. The org and the PRS.md
  path come from `.ai-notes/config.yml` when omitted. It's idempotent, so you can schedule it with
  cron, launchd or CI at whatever cadence you like.
- `tools/clean-merged-worktrees.sh`: lists worktrees whose branches have been merged, including
  squash and rebase merges when `gh` is available. It's a dry run unless you pass `--delete`.
- `tools/config.example.yml`: every config key, with comments.

## Viewer (optional)

`webapp/` is a small local web app for browsing and editing the notes repo (search, tag filters,
pending-PRs widget). See [`webapp/README.md`](webapp/README.md).

## License

[MIT](LICENSE)
