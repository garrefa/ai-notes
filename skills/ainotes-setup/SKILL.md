---
name: ainotes-setup
description: Creates or updates a workspace's .ai-notes/config.yml — the shared config every ainotes-* skill reads. Full setup mode creates .ai-notes/ if missing and interactively asks about each setting (org name, notes repo, VCS org, optional Jira, Slack, CI deploy comment, task statuses), creating the notes repo from the bundled template if needed and explaining what each is used for. Repo-registration mode scans the workspace root for cloned git repos and, for any repo that's neither tagged in domain_taxonomy nor listed in ignored_repos, asks the user to tag it (suggesting domains based on name/stack similarity to existing ones) or ignore it. Also invoked automatically by two hooks — at SessionStart when the current repo is unregistered, and right after a `git clone` lands a new top-level repo in the workspace. Trigger on "setup ainotes", "init ainotes config", "configure ainotes", "register new repos", "check for unregistered repos", or a hook nudge naming an unregistered repo.
---

# ainotes-setup

Owns `.ai-notes/config.yml` at the workspace root — the one file every `ainotes-*` skill
reads instead of hardcoding organization details (see `ainotes-notes` for the discovery rule: walk up
from the current directory until a `.ai-notes/` directory turns up; its parent is the workspace root).
This skill is how that file gets created in the first place, and how it stays current as repos get
added to the workspace.

It has two modes. Use **Full setup** when `.ai-notes/config.yml` doesn't exist yet (or the
user explicitly asks to redo it from scratch). Use **Repo registration** for everything else,
including every hook-triggered invocation.

## Full setup

Run when no `.ai-notes/config.yml` is found by walking up from the current directory.

1. **Confirm the workspace root.** Default to the current directory, but ask if it's not obviously a
   folder containing multiple sibling repos (e.g. it looks like you're already inside one specific
   repo). This directory is where `.ai-notes/` will be created.
2. **Create `.ai-notes/`** at that root if it doesn't already exist.
3. **Ask each setting conversationally**, one at a time or in small logical groups, explaining what
   it's used for before asking (don't just present a bare form). Accept "skip"/"none" for anything
   optional — an empty or missing setting should never block finishing setup.

   - **Org name** (`org_name`, optional): a human-readable name used in generated prose where it
     reads naturally — the `ainotes-report` title and the intro line of an
     `ainotes-pr-review-request` Slack message. Purely cosmetic.
   - **Notes repo** (`notes_repo`, required, default suggestion `notes`): the directory name — and
     its own separate git repo, nested inside the workspace — where `ainotes-notes`, `ainotes-task`,
     `ainotes-report`, `ainotes-pr-tracker`, `ainotes-daily-plan`, and `ainotes-tasks` all store their
     notes, plans, PR ledger, task ledger, and daily plans. Ask whether it already exists (point at
     it) or should be created fresh. If it should be created, see **Creating the notes repo** below.
   - **VCS org** (`vcs.org`, required if any GitHub-dependent skill will be used): the GitHub org or
     user the workspace's repos live under. Used by any skill that shells out to `gh`/`gh api`
     (`ainotes-pr-tracker`, `ainotes-babysit-prs`, `ainotes-pr-review-request`).
   - **Jira** (`jira.project_key` / `jira.base_url`, optional): ask "Do you use Jira?" first. If
     yes, ask for the project key (e.g. `PROJ`) and the browse base URL (e.g.
     `https://acme.atlassian.net/browse/`) — used by `ainotes-task` (getting/creating a ticket per
     task), `ainotes-report` (linking keys), and the ledgers' `Jira` columns. If no (or a different
     tracker), **omit the whole `jira` block** — every skill treats a missing block as "Jira
     disabled": no ticket step, no ticket questions, no Jira links.
   - **Slack PR review channel** (`slack.pr_review_channel`, optional): only relevant if
     `ainotes-pr-review-request` will be used. Ask for the channel name (e.g. `#pr-review`), or
     write `null` if not wanted — that skill then reports itself disabled.
   - **CI deploy comment** (`ci.deploy_trigger_comment`, optional): if the team triggers deploys or
     preview environments by commenting on a PR (e.g. `/deploy`), ask for that exact comment text.
     `ainotes-babysit-prs` only ever posts it after asking. Otherwise write `null` —
     `ainotes-babysit-prs` then just reports a PR as ready and stops.
   - **Task statuses** (`task_statuses`, optional): the workflow statuses `ainotes-tasks` uses. Show
     the four defaults (`backlog` → `in-progress` → `done` / `dropped`, the last two closed) and ask
     one question: "keep these defaults?" If yes, write them as-is. If not, take the user's edits
     (rename, add, remove, reorder, change which are closed) in a single round — don't interview
     status by status. Don't ask about colors: they're a viewer-only setting, changed in the viewer's
     Settings.
     Remind them the first entry is the default for new tasks, and refuse to write a list without
     at least one closed and one non-closed status.
   - **`ignored_repos`** and **`domain_taxonomy`**: don't ask about these as raw config — populate
     them via the **repo scan** below instead.
   - **`preferred_epics`**: leave empty. It's explained in `ainotes-notes` as a living list grown
     over time as real epics are confirmed — don't seed it with guesses.

4. **Run the repo scan** (below) to populate `ignored_repos` and `domain_taxonomy`.
5. **Write the file** using the canonical schema below, show the user the final result, and confirm
   it looks right.

### Canonical config schema

Write keys in this order, with these names — every `ainotes-*` skill and hook reads exactly these:

```yaml
org_name: "Acme"                 # used in generated prose only
notes_repo: notes                # dir (its own git repo) at the workspace root holding notes/plans/ledgers
vcs:
  org: acme                      # GitHub org/user for `gh`; GitHub is the only supported VCS
jira:                            # OPTIONAL. Omit the whole block to disable all Jira steps.
  project_key: PROJ
  base_url: https://acme.atlassian.net/browse/
preferred_epics: []              # [{key, name}] suggestions only; grown as the user confirms epics
slack:
  pr_review_channel: null        # null/absent disables ainotes-pr-review-request
ci:
  deploy_trigger_comment: null   # e.g. "/deploy"; null => ainotes-babysit-prs never posts a deploy comment
task_statuses:                   # ainotes-tasks statuses; order matters: first = default for new tasks
  - { key: backlog,     label: Backlog }
  - { key: in-progress, label: In progress }
  - { key: done,        label: Done,        closed: true }   # closed: true = finished
  - { key: dropped,     label: Dropped,     closed: true }
ignored_repos: []
domain_taxonomy: {}              # domain -> [repos]; populated by the repo scan
```

`task_statuses` rules: `key` is what's written in task frontmatter and `TASKS.md`; `label` is the
human-readable name used in chat and reports; `closed: true` marks a finished status (Completed table).
There is no `color` field: status colors are a viewer-only setting, configured in the viewer's Settings.
At least one closed and one non-closed status are required. If the key is absent, skills use exactly
the four defaults above.

A commented copy lives at `<skill base dir>/../../tools/config.example.yml`.

### Creating the notes repo

When the user wants `notes_repo` created fresh (it doesn't exist yet at `<workspace-root>/<notes_repo>`):

1. Create the directory and `git init -b main` it (fall back to `git init` + `git checkout -b main`
   on older git).
2. Copy the skeleton from `<skill base dir>/../../templates/notes-repo/` (Claude is told the skill's
   base directory when it loads) into it — including dotfiles (`.gitignore`):
   ```bash
   cp -R "<skill base dir>/../../templates/notes-repo/." "<workspace-root>/<notes_repo>/"
   ```
   That gives it `README.md`, `CLAUDE.md`, and `.gitignore` at the root, plus the data files
   (the canonical layout defined in `ainotes-notes`): `INDEX.md`, `PRS.md`, `TASKS.md`
   (headers and empty tables only) and empty `notes/`, `plans/`, `tasks/`, `daily/`
   (each holding a `.gitkeep` so git tracks it). If the template directory can't be found, stop and tell the user
   rather than hand-writing a divergent skeleton.
3. Make an initial commit: `git -C <notes_repo> add -A && git -C <notes_repo> commit -m "Initialize notes repo"`.
   Don't add a remote or push — that's the user's call.

If the directory already exists but isn't a git repo, ask before running `git init` in it, and never
overwrite existing files with template copies.

### Migrating a legacy notes repo

Older notes repos (from before the layout was flattened) kept their data (`notes/`, `plans/`,
`tasks/`, `daily/`, `INDEX.md`, `PRS.md`, `TASKS.md`) nested one level under a `db/` folder. Whenever
this skill runs (full setup or repo registration) and finds `<workspace-root>/<notes_repo>/db/`
holding any of those entries, tell the user and offer to migrate — never move anything without an
explicit yes. On request, do it as a single commit at the notes repo root:

```bash
cd "<workspace-root>/<notes_repo>"
for p in db/* db/.[!.]*; do
  [ -e "$p" ] || continue
  git mv "$p" "$(basename "$p")" 2>/dev/null || mv "$p" "$(basename "$p")"
done
rmdir db 2>/dev/null || true
git commit -m "Flatten notes data out of db/"
```

Entries that aren't tracked by git yet (`git mv` refuses them) should be `git add`ed first, or moved
with plain `mv` and then added. Links inside the ledgers/`INDEX.md`/frontmatter need no rewriting:
they were already relative to the data root (`notes/...`, `tasks/...`), which stays the data root.
Afterwards create any missing subfolder or ledger from the template (without overwriting) so the
layout is complete. Don't push — that's the user's call.

## Repo registration

This is the mode hooks invoke, and also what running this skill does once `.ai-notes/config.yml`
already exists.

### Scope

- **Hook-invoked** (SessionStart or post-clone): scope to exactly the one repo the hook named. Don't
  scan for or ask about any other unregistered repos in the same breath — that would derail whatever
  the user was actually doing. If other unregistered repos happen to exist, it's fine to mention their
  count in passing, but don't act on them.
- **User-invoked** ("register new repos", "check for unregistered repos", or running Full setup's
  repo scan): handle every currently-unregistered repo in one pass.

### The scan

1. List top-level directories directly under the workspace root.
2. Keep only real git repos (contain a `.git`).
3. Drop: hidden directories (leading `.`, e.g. `.ai-notes`, `.claude`, `.git`), and the configured
   `notes_repo` — it's never a tagging candidate.
4. Of what's left, a repo is **unregistered** if its name appears neither inside `ignored_repos` nor
   inside any `domain_taxonomy` list. (Either may be written as flow lists (`[a, b]`) or block lists (`- a`) — it's a simple membership check.)
5. For hook-invoked runs, narrow this to just the named repo. For user-invoked runs, keep the full
   set.

### Per unregistered repo

For each one:

1. **Suggest a domain** (see "Suggesting tags" below) — zero, one, or two candidate domains, never
   more.
2. **Ask** (AskUserQuestion when the options are discrete and few): ignore this repo, tag it with one
   of the suggested domains, or tag it with a domain not suggested (existing or brand new — multiple
   domains are fine if it genuinely spans them). Always allow free text; a suggestion is a shortcut,
   never an assumption.
3. **Apply**:
   - Ignore → append the repo name to `ignored_repos`.
   - Domain(s) → append the repo name to each chosen domain's list in `domain_taxonomy`, creating a
     new domain key if the user named one that doesn't exist yet.
4. **Write the config** after each repo (or once at the end of a batch, for a user-invoked full
   scan — either is fine, but never leave a partially-applied answer unwritten if something interrupts
   the flow).

Report back briefly — one line per repo handled ("`new-service` → tagged `platform`", "`scratch-fork`
→ ignored") — not a big write-up. This file isn't in its own git repo at the workspace root in every
setup, so there's no commit step; just write it. If the workspace root *does* happen to be a git repo,
don't auto-commit on its behalf — that's the user's call, not this skill's.

### Suggesting tags

Keep this cheap — a repo's tagging question is a small aside, not a research task:

1. Build a keyword index from `domain_taxonomy` as it stands: for each domain, split its current
   repos' names on `-` into words.
2. Split the new repo's name on `-` the same way, and score each existing domain by word overlap
   (e.g. a repo named `payments-ledger` sharing no words with anything yet suggests a *new* domain;
   one named `billing-relay` overlapping `payments`'s existing repo `billing-service` suggests reusing
   `payments`).
3. Optionally strengthen or add a guess with one cheap peek: check for a handful of well-known build
   files (`package.json`, `pom.xml`/`build.gradle`, `go.mod`, `Cargo.toml`, `Gemfile`,
   `requirements.txt`) or the repo's own `CLAUDE.md`/`README.md` first paragraph, if it's fast to
   check. Don't do a deep investigation of the repo's contents for this.
4. Offer at most the top 1–2 scoring domains as suggestions. If nothing scores meaningfully, don't
   force a suggestion — just ask outright with no candidates pre-filled.
5. A suggestion is never applied without the user's explicit confirmation.

## Notes

- Never invent a value for a required setting (`notes_repo`, `vcs.org` if GitHub skills are in play)
  — always ask, same discipline the rest of this toolkit follows for Jira tickets and epics.
- `ignored_repos` and "not yet tagged" are different states, and this skill treats them differently:
  an ignored repo is never asked about again; an untagged repo keeps getting surfaced (by the hooks or
  by a manual "check for unregistered repos") until someone makes a call on it.
- This skill only ever adds to `domain_taxonomy`/`ignored_repos` — it doesn't remove or re-tag an
  already-registered repo. Re-tagging an existing repo is a direct edit to
  `.ai-notes/config.yml`, not something this skill's scan flow does on its own initiative.
