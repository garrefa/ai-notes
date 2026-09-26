# AINotes viewer

An optional, local browser viewer for AINotes notes repos. It lists and renders the notes, plans, daily plans, and tasks the
`ainotes-*` skills write, lets you filter them by date range and tag, search them with a command
palette (`Cmd/Ctrl+K`), edit a note's body or tags in place, and browse the PRs tracked in
`PRS.md` under **Pull requests**. Tasks show their status as a colored dot and can be moved between statuses from the
viewer. You can track several notes repos at once and switch between them in one click.

There is no server component: the app runs entirely in the browser and reads the notes repo straight
from disk through the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API).
It only reads the notes repo you pick; it never reads your workspace's `.ai-notes/config.yml`.

## Requirements

- **Node.js 20.19+ or 22.12+** (what Vite 8 requires; any current LTS works).
- **A Chromium-based browser** (Chrome 133+, Edge, Arc, Brave) with `showDirectoryPicker` and
  `FileSystemObserver` support. Other browsers show an "unsupported" message instead of the
  connect button, but can still open the [demo](#try-the-demo).

## Run it

Quickest, with nothing to clone — always the latest published version:

```bash
npx ainotes-viewer@latest
```

It builds nothing at runtime (the published package ships a prebuilt `dist/`), serves it on
`http://localhost:4173` by default (`--port <n>` to change), and opens it in your default browser
(`--no-open` to skip that). Pin a version instead of always getting the latest with
`npx ainotes-viewer@0.1.0`, and check what's running with `npx ainotes-viewer --version`.

The same package also bundles the two `tools/*.sh` scripts that read `.ai-notes/config.yml`
(`snapshot-agents.sh`, which feeds the Agents view, and `check-prs.sh`) as subcommands —
`npx ainotes-viewer snapshot-agents [args...]` / `npx ainotes-viewer check-prs [args...]`, run from
inside the workspace so they can auto-discover it. Root README's [Tools](../README.md#tools-no-llm-needed)
section has the details, including why `npm install -g` beats `npx` for scheduling one every 60s.

To work on the source instead:

```bash
cd webapp
npm install
npm run dev        # prints the local URL, http://localhost:5173 by default
```

Open the printed URL in your Chromium-based browser. (If port 5173 is taken, Vite picks the next free
one and prints that instead.)

To build a static bundle and serve it locally instead:

```bash
npm run build      # type-checks, then outputs to webapp/dist/
npm run preview    # serves dist/ on http://localhost:4173
```

`dist/` is plain static files. It can be served from anywhere that uses `localhost` or HTTPS (the
File System Access API only works in secure contexts).

Each build also writes `dist/version.json` with a build ID (the commit's short SHA plus the build
time) and bakes the same ID into the bundle. An open tab re-reads that file every 5 minutes and
whenever the tab regains focus. When the ID on the server differs, a **New version available** notice
offers a **Reload** button. Reloading stays the user's choice, since it discards an unsaved edit or
the demo's in-memory changes. For it to work, your host must not cache `version.json` or
`index.html` for long (the hashed files in `assets/` can be cached forever). `npm run dev` skips the
check because Vite reloads the page on its own.

## Try the demo

Not ready to connect a notes repo, or just want to see how it works? Click **Try the demo** in the
empty state, the folder switcher or the command palette (`Cmd/Ctrl+K`). It opens two sample
workspaces you can switch between like real folders:

- **Work**: a payments team's notes (an incident investigation, a retro, an architecture sync),
  plans in every state, daily plans, tasks linked to Jira keys and PRs, and a PR ledger with
  passing, failing, conflicted and approved PRs.
- **Personal**: university study (lecture notes, a paper reading, a thesis meeting, an exam study
  plan), housekeeping (a repair log, a cleaning routine, a budget check-in), personal tasks with
  deadlines, and a small PR ledger for a course lab repo.

The demo runs in memory and works in any browser. You can edit notes, tags and task statuses; the
changes last until you reload or exit the demo, and nothing is written to disk or added to your
saved folder list. Its dates are shifted on load so it always looks like recent work. **Exit demo**
(in the banner, the folder switcher or the command palette) removes both sample workspaces.

The sample files live in `src/demo/<workspace>/`, in the same layout as a real notes repo. They
are written as if today were 2026-03-18 (`FIXTURE_TODAY` in `src/lib/demo-workspaces.ts`); keep
new ones relative to that date, and avoid weekday or month names, which the date shift can't update.

## Connect your notes repos

1. Open the app and click **Connect folder** in the sidebar.
2. In the folder picker, choose your **notes repo**: the folder named by `notes_repo` in your
   workspace config (it has `notes/`, `plans/` and the rest of the layout directly inside it).
3. Grant read/write access when the browser asks. Write access is only used when you edit a note's
   body, tags or a task's status from the viewer.

### Several repos, fast switching

- **Add another notes repo:** open the folder switcher at the top of the sidebar (it shows the current
  folder's name) and choose **Add folder…**. Picking a folder that's already tracked just switches to
  it.
- **Switch:** choose a folder from the same menu, or press `Cmd/Ctrl+K` and pick
  **Switch to &lt;name&gt;**. Switching clears the selected note, filters and search, so nothing
  carries over from one repo to another.
- **Rename, locate or remove:** use the `›` next to a folder in the switcher. **Rename…** only
  changes the name shown in the app (it defaults to the folder's name). **Locate…** points the entry
  at a folder that moved. **Remove from list** makes the app forget the folder. Nothing on disk is
  touched.

The list of folders and the one you had open are stored in the browser's IndexedDB. The last active
folder opens automatically on your next visit, and the view refreshes live as files change on disk.
Browsers sometimes drop a folder's permission between visits. When that happens the folder shows
**Grant access** (in the switcher, the sidebar footer and the main pane), and one click brings back
the permission prompt. If you connected a single folder with an older version of the viewer, it's
moved into the list automatically the first time you load this version.

If a tracked folder is deleted, moved, renamed or on a drive that isn't connected (or stops
responding for 10 seconds), it shows as **Missing** in the switcher instead of leaving the app stuck
on "Connecting…". That also applies while it's open. The entry is kept, because an unplugged drive
may come back: select it to retry, use **Locate…** to point it at the new place, or click the trash
icon next to it to remove it in one click. If the folder you had open last is missing when the app
loads, it opens the most recently used folder that is available instead.

## Data layout

Notes repos keep all their data directly at the repo root (see `templates/notes-repo/`):

```
<notes_repo>/
  notes/     dated notes (YYYY-MM-DD-*.md)
  plans/     dated plans
  daily/     daily plans (YYYY-MM-DD.md)
  tasks/     one file per task
  INDEX.md   tag index (maintained by ainotes-notes)
  PRS.md     PR ledger: the "Pending (open)", "Merged" and "Closed (not merged)"
             tables, plus the optional "Pending — Detail" table that
             tools/check-prs.sh generates (shown in the Pull requests view)
  TASKS.md   task ledger (shown in the Tasks view with the task files)
```

The viewer reads and writes everything (note edits, `PRS.md`, tasks, daily plans) directly at the
repo root. Older, un-flattened repos that still keep their data nested one level under a `db/`
folder still work: pick the repo root (the viewer finds its `db/` subfolder and uses that as the
data folder) or pick the `db/` folder itself — either way. Missing directories are simply skipped.

Picking a folder with none of the above (no `notes/`, `plans/` or `db/`) falls back to a **flat**
layout instead of refusing the folder: every `.md` file anywhere under it (any depth, skipping
dotfiles/dot-directories and `node_modules`) is read as a note, using its real path. Since arbitrary
files rarely carry the `date`/`tags` frontmatter the Date range and Tags filters assume — and the
date filter's "last 7 days" default would otherwise hide everything undated — both are hidden for a
flat folder and every note just shows. Editing and saving works the same as any other note.

## Pull requests

**Pull requests** in the sidebar's Library lists the PRs in `PRS.md`, in the same list and
detail panes the notes use.

- **List:** PRs are grouped by repo and sorted by number. Each row shows the PR title,
  `repo#number`, the Jira key, and compact hints from the Detail table: CI status, review state
  (changes requested / approved), behind base or merge conflicts, unresolved comment count, and how
  long it's been open and since its last commit.
- **Filters:** the chips above the list switch between **Pending** (the default), **Merged** and
  **Closed**, each with its count, and narrow the list to one repo. The sidebar's date range filters
  by the date the PR was opened. The tag filter doesn't apply to PRs, so it's hidden in this view.
- **Details:** selecting a PR shows an **Open on GitHub** button (opens a new tab) and everything
  the ledger has for it: repo, opened/merged/closed dates, open for, last commit, Jira key (a link
  when the ledger cell is a markdown link), last checked; then the failing CI checks, behind base or
  conflicts, each reviewer with their review state, the code owners it's still waiting on, and the
  unresolved comment snippets. A pending PR with no Detail row yet says so.
- **Tasks:** if a task's `prs:` frontmatter lists the PR (`org/repo#123`), the task appears under
  **Task** with its status dot. Click it to open the task.
- **Search:** `Cmd/Ctrl+K` also finds PRs by title, repo, number or Jira key.

The view updates live when `PRS.md` changes on disk. If the folder has no `PRS.md` (or no PRs in the
chosen state), the list says so; `check prs` (the ainotes-pr-tracker skill) and
`tools/check-prs.sh` maintain it.

## Task statuses

Each task file in `tasks/` has a frontmatter `status:`. The viewer has four built-in statuses:

| Status        | Label       | Default color | Closed |
|---------------|-------------|---------------|--------|
| `backlog`     | Backlog     | `#9ca3af`     | no     |
| `in-progress` | In progress | `#3b82f6`     | no     |
| `done`        | Done        | `#22c55e`     | yes    |
| `dropped`     | Dropped     | `#ef4444`     | yes    |

A task with no `status:` counts as `backlog`. Older values still work: `open` counts as `backlog`.
Any other value (for example a custom status from your workspace's `task_statuses`) shows as a gray
dot labeled with its raw text and counts as not closed, until you change that in Settings. Closed
statuses count as finished.

- Every task in a list shows a dot in its status color (hover it for the label). Statuses are
  separate from tags.
- In the Tasks view, the **Status** filter picks which statuses to show. It lists the built-in
  statuses plus every other status used by the open folder's tasks. By default it shows every status
  that isn't closed.
- In a task's detail pane, the status button changes the status. It offers the same list as the
  filter: the built-ins plus the other statuses found in this folder's tasks. Changing it rewrites only the `status:`
  line of the task file, adds `- YYYY-MM-DD: status → <label>` under its `## Updates` section (if it
  has one), and updates the task's row in `TASKS.md`. A task that moves between open and closed
  moves between the Open and Completed tables, and its Completed date is set or cleared. If
  `TASKS.md` or the row is missing, only the task file is updated and the viewer says so.

### Settings

Click the gear button in the header (or press `Cmd/Ctrl+K` and choose **Settings**) to customize
statuses. The dialog lists the built-ins and every status found in the open folder's tasks. For each
one you can:

- pick its **color**, used for the dots and the filter chips;
- toggle **Closed**. Closed statuses are hidden by the default filter, and a task moved to one goes
  to the Completed table in `TASKS.md` (moving it to a non-closed status moves it back to Open);
- **reset** it to its default. **Reset all to defaults** clears every customization.

Changes apply immediately. They're stored in this browser's `localStorage`, keyed by status, and
shared by every folder you open in this browser. They aren't written to your notes repo or config,
so another browser or machine starts from the defaults. If the browser blocks storage, the viewer
uses the defaults.

## Development

```bash
npm run lint       # oxlint
npm run build      # type-check (tsc -b) + production build
```
