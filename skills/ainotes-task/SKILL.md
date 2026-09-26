---
name: ainotes-task
description: Plan-then-execute workflow for a task in one of the git repos checked out under this workspace (the directory holding `.ai-notes/config.yml`). Creates a fresh worktree off the up-to-date default branch, plans with a Plan subagent, gets user approval, then executes with one or more subagents. Use when the user says "work on X in <repo>", "let's do a task in <repo>", or invokes /ainotes-task.
---

# Task Workflow

Orchestrates a single task end-to-end in one repo of this workspace (the workspace root is the
directory containing `.ai-notes/` — see the `ainotes-notes` skill for the discovery rule).
You (the orchestrator) do the git/worktree setup and plan-approval yourself; subagents do the planning
analysis and the execution.

`<notes_repo>` below means the `notes_repo` value from the workspace's `.ai-notes/config.yml`.

## Arguments: $ARGUMENTS

Parse the user's message (after `/ainotes-task`, or their natural-language request) for:
- **repo**: which of the workspace's repos this targets. If ambiguous or missing, ask.
- **task**: what they want done.

If the repo isn't a top-level git repo under the workspace root (the configured `notes_repo` and
anything in `ignored_repos` don't count), ask for clarification rather than guessing.

## Steps

### 1. Get the default branch name (cached) and sync it

The default branch name itself essentially never changes, so cache it per repo instead of re-detecting
every time. The freshness that actually matters — the branch's *content* — is handled by the mandatory
fetch below, which always runs regardless of cache hit or miss.

Cache file: `<workspace-root>/.ai-notes/default-branches.txt`, one line per repo: `<repo> <branch>`
(format reference: `default-branches.txt` in this skill's own directory — never write to that one).

1. Check the cache:
   ```bash
   grep "^<repo> " <workspace-root>/.ai-notes/default-branches.txt 2>/dev/null
   ```
2. **Cache hit**: use that branch name, skip detection, go to step 3.
3. **Cache miss**: detect it, then append `<repo> <branch>` to the cache file (create it if it doesn't
   exist yet):
   ```bash
   cd <workspace-root>/<repo>
   git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
   # fallback if that's empty:
   git remote show origin | sed -n 's/.*HEAD branch: //p'
   ```
4. **Always**, before creating a *new* worktree, fetch the real thing regardless of what the cache says:
   ```bash
   cd <workspace-root>/<repo>
   git fetch origin <default-branch>
   ```
   If this fails because `<default-branch>` doesn't exist on the remote anymore, remove its line from
   the cache file and re-detect (step 3) — it was renamed upstream — then fetch again.

   Best-effort, non-blocking: if the main checkout is currently *on* `<default-branch>`, fast-forward
   it too, so it doesn't sit stale indefinitely:
   ```bash
   [ "$(git branch --show-current)" = "<default-branch>" ] && git merge --ff-only origin/<default-branch>
   ```
   If the main checkout is on something else, leave it alone — don't switch branches out from under it.
   Either way, the worktree in step 2 bases off `origin/<default-branch>` directly, so this step's
   success or failure doesn't block worktree creation.

Once a worktree exists, it's fine for it to fall behind the default branch over time — only re-sync it
if the user explicitly asks to update it. This "must be fresh" requirement is only for the moment of
creating a *new* worktree.

### 2. Create the worktree

Branch off the freshly fetched remote ref, not local `<default-branch>` (which may be stale):

```bash
git worktree add .worktrees/<branch-name> -b <branch-name> origin/<default-branch>
```

- `.worktrees/` lives inside the repo and should be gitignored — check `.gitignore` and add an entry
  (`.worktrees/`) if it's missing, as a small standalone commit on the default branch (ask first if
  the repo has no existing convention for this).
- Derive `<branch-name>` as a short kebab-case slug of the task (e.g. `fix-token-expiry`). If the
  user gave a ticket ID, prefix with it (e.g. `PROJ-123-fix-token-expiry`).
- If a worktree for this branch name already exists, reuse it (`git worktree list` to check) instead
  of erroring — this may be a resumed task.

### 3. Plan

Launch a `Plan` subagent (Agent tool, `subagent_type: "Plan"`, `model: "inherit"`) with a self-contained prompt including:
- The task in the user's own words.
- The repo name and the worktree path from step 2 (all file exploration should happen there, not in
  the main checkout).
- A pointer to read that repo's own `CLAUDE.md` and `.cursor/rules`/`.cursorrules` first for
  conventions, build/lint/test commands, and architecture notes.

Do not let the Plan subagent edit files — it only researches and returns a plan.

### 4. Get approval

Present the returned plan to the user yourself (don't just say "the plan is ready" — show it). Ask
them to approve, redirect, or request changes. Do not proceed to execution until they explicitly
approve. If they ask for changes, relaunch the Plan subagent (or reason it through yourself for small
tweaks) and re-confirm.

### 5. Record the plan in the notes repo

Invoke the `ainotes-notes` skill's "Adding/updating a plan" procedure to persist the approved plan as
`<notes_repo>/plans/YYYY-MM-DD-<repo>-<slug>.md` (same date/repo/slug as the worktree/branch), including
its epic question, domain tagging, and commit. `ainotes-notes` owns the frontmatter schema, domain
taxonomy, and the notes repo's git history — this step just triggers it with: the task, the repo, the
worktree path, and the approved plan text. You ask the epic question and assemble the fields here;
the write itself goes to the `notetaker` agent as that skill describes (named `ainotes:notetaker` when
AINotes is installed as a plugin; if neither name is available, spawn a general-purpose agent with
`model: haiku` and give it the contents of `<skill base dir>/../../agents/notetaker.md` as its
instructions). Keep the `path` it returns for steps 6 and 10 — don't re-read the file.

### 6. Get a Jira ticket (only if Jira is configured)

Read the workspace's `.ai-notes/config.yml`. **If it has no `jira` block, skip the ticket part of this step entirely** —
don't ask about a ticket, don't create one, and leave the plan's `jira` field `null`. Just hand
`notetaker` a frontmatter-only update of the plan (`{path, status: in-progress}`) and move on to step 7.

If `jira.project_key` is set, that's the target project. Before execution starts, ask the user: do
they already have a ticket for this task, or should one be created?

- **They have one**: record its key.
- **They want one created**: create it under that project (use whatever Jira skill or Atlassian MCP
  tools are available — follow any review/approval flow they define before publishing; don't create
  it silently). Ask which sprint/epic to use if the project needs one — never assume a default.
- With Jira configured, never skip this question and never assume — always ask, even if the task looks trivial.

Hand `notetaker` a frontmatter-only update of the plan note (`{path, jira: <PROJECT_KEY>-<number>,
status: in-progress}`); it commits. If `ainotes-tasks` has an active task for this session, also spawn
`ledger-keeper` with `task_link {task, jira}` (same naming and fallback pattern, with
`<skill base dir>/../../agents/ledger-keeper.md`; pass `notes_repo_path` and `toolkit_dir` =
`<skill base dir>/../..`).

### 7. Execute

Launch execution subagent(s) (Agent tool, `subagent_type: "general-purpose"`, `model: "inherit"`) — fresh agents, so each
prompt must be self-contained:
- The approved plan (verbatim or faithfully summarized — don't let an agent re-derive it).
- The worktree path — all edits happen there.
- The Jira ticket key if step 6 produced one, for reference (e.g. if the agent writes commit messages later).
- Instruction to follow the repo's own CLAUDE.md/cursor rules for conventions and to run that repo's
  build/lint/test commands before reporting done.
- Its specific slice of the plan, if you're splitting work across multiple agents.
- **TDD, whenever the task involves code**: write the failing test(s) first, run them and confirm they
  actually fail (red) — don't assume, check — then implement, then run them again and confirm they
  pass (green). Skip only when there's no meaningful automated test surface (pure docs/config changes),
  and say so explicitly rather than silently skipping.
- Leave the work **uncommitted** in the worktree — do not commit yet, review comes first (step 8).

Split across multiple agents only when the plan has genuinely independent parts (different
modules/files with no shared state); otherwise use a single execution agent to avoid merge conflicts
between agents working in the same worktree.

### 8. Review

Before anything gets committed, spawn a separate review subagent (Agent tool, `subagent_type: "general-purpose"`,
`model: "inherit"`) with minimal, targeted
context — not the full execution transcript:
- The original task/plan, verbatim.
- A summary of what was actually done (files touched, approach, test results).
- Anything genuinely load-bearing for judging correctness (an unusual constraint hit along the way, a
  deliberate deviation from the plan).

Point it at the worktree's diff against the default branch. The `code-review` skill's checklist
(correctness bugs, reuse/simplification/efficiency) is a good basis if you want to lean on it, but the
review must run as an independent subagent, not inline in your own context.

- **Issues found**: fix them (relaunch an execution subagent with the specific findings), then
  re-review. Don't proceed to step 9 until a review pass comes back clean.
- **Clean**: proceed to step 9.

### 9. Ask to commit

Do not commit automatically, even after a clean review. Show the user a summary of what was done
(files touched, approach, test/build results, review outcome) and ask explicitly whether to commit.
Only on their yes, commit the finished work on the branch with a proper title + descriptive body.

### 10. Hand back

- Report what changed and the results of build/lint/test/review.
- Do **not** push or open a PR automatically — that's always a separate, explicit ask, regardless of
  how clean the review or how routine the task looks. If the user does ask and a PR gets opened,
  register it right away: spawn `ledger-keeper` with `register_pr {repo, number, url, title, jira?,
  task_file?}` (see `ainotes-pr-tracker`; `task_file` = the session's active task, if any).
- Mention the worktree path (and the Jira ticket key, if any) so they know where to look.
- Invoke `ainotes-notes`'s "When a plan is executed" procedure: you write the outcome body, and one
  `notetaker` call writes a **new** note recording it and flips the plan's `status` field (don't append
  results into the plan file yourself — the plan's body stays immutable).

## Notes

- One task = one worktree = one branch = one plan note in `<notes_repo>/plans/` = at most one Jira
  ticket (when Jira is configured). Don't
  reuse a worktree or plan across unrelated tasks.
- If the user wants a worktree cleaned up, use `git worktree remove` (from the main checkout) rather
  than deleting the directory by hand. Leave its plan/completion notes in `<notes_repo>/` as a
  historical record.
- All notes-repo content, format, and git mechanics belong to the `ainotes-notes` skill (and, for
  ledgers, `ainotes-pr-tracker`/`ainotes-tasks`) — don't write to `<notes_repo>/` directly from here;
  every write goes through the `notetaker` or `ledger-keeper` agent, to keep one writer and one source
  of truth for each format.
- Subagents are always spawned with an explicit `model`: `inherit` for the Plan, execution and review
  agents (they do the real engineering), `haiku` for notes-repo bookkeeping. If your Agent tool
  rejects the literal `inherit`, omit `model` for those three instead — an omitted model inherits the
  main thread's.
