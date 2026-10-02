# AINotes viewer

An optional, local browser viewer for AINotes notes repos. It lists and renders the notes, plans, daily plans, and tasks the
`ainotes-*` skills write, lets you filter them by date range and tag, search them with a command
palette (`Cmd/Ctrl+K`), create, edit, favorite and delete them in place, and browse the PRs
tracked in `PRS.md` under **Pull requests**. Tasks show their status as a colored dot and can be moved between statuses from the
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

The same package also bundles the whole Claude Code toolkit, so it doubles as its installer:
`npx ainotes-viewer install <workspace-dir>` does what `install.sh` does from a clone (skills,
agents, hooks, tools and templates into `<workspace-dir>/.claude/`, a `run-viewer.sh` at the
workspace root that opens this viewer, and the offer to schedule `snapshot-agents.sh`, which feeds
the Agents view). The two workspace-aware tools also run directly:
`npx ainotes-viewer snapshot-agents [args...]` / `npx ainotes-viewer check-prs [args...]`, from inside
the workspace. See the root README's [Quick start](../README.md#quick-start) and
[Tools](../README.md#tools) sections.

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

The running release number (`version` in `package.json`) shows at the bottom of the sidebar, linked
to the changelog, and in **Settings**; hover it for the build ID.

Each build also writes `dist/version.json` with that release number and a build ID (the commit's
short SHA plus the build time), and bakes both into the bundle. An open tab re-reads that file every
5 minutes and whenever the tab regains focus. When the build ID on the server differs, a notice offers
a **Reload** button and names what changed: "AINotes v0.2.0 is available (you're on v0.1.0)" for a
new release, or "A new build of AINotes v0.1.0 is available" for a redeploy of the same one. The build
ID, not the version, is what triggers it, since a deploy between releases changes the code without
changing the version. Reloading stays the user's choice, since it discards an unsaved edit or
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
3. Grant read/write access when the browser asks. Write access is only used when you create, edit
   or delete something from the viewer (see [Creating, editing and deleting](#creating-editing-and-deleting)).

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
  reviews/   one note per reviewed PR (YYYY-MM-DD-<repo>-<number>.md, ainotes-review-notes)
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

## The Library

The sidebar's **Library** lists **Agents**, **Pull requests**, **Favorites**, **All notes**, **Notes**,
**Plans**, **Daily**, **Tasks** and **Reviews**, in that order by default. Drag an item (or focus it and press
`Alt+↑`/`Alt+↓`) to reorder; the order is remembered in this browser. Once a folder is open, an item
with nothing to list is hidden (a folder with no plans shows no **Plans**, and **Favorites** only
appears once something is favorited); **Agents** and **Pull requests** always show, since their
empty state explains how to fill them. If the item you're on empties (you unfavorite the last
favorite, say), the viewer moves to **All notes**.

The **Date range** filter applies to **All notes**, **Notes**, **Plans**, **Daily** and **Reviews**
only. Tasks, favorites, PRs and agents always list everything, whatever their date.

**Reviews** lists `reviews/`, the notes `ainotes-review-notes` files for each PR you review. A
review is titled by its `# Review: repo#123 · …` heading, shows its latest verdict (Approved,
Commented or Changes requested) as its status, and is dated by its latest review (`last_reviewed:`),
so a re-reviewed PR comes back up the list. The `<!-- review-history:end -->` marker in its body
isn't shown: HTML comments are left out of every rendered note.

The open note follows the filters like every other note. When it stops matching (you change the
view, tag, date range or task-status filter, or edit its own tags or status), it's deselected and
the list's first note opens; it isn't reselected if a later filter lets it back in. Changing a
filter with unsaved edits asks first. Opening a specific note (from `Cmd/Ctrl+K`, a task link on a
PR, or a note you just created) loosens whichever filter would hide it.

The list column starts at 28rem, its widest; drag its edge, or focus the divider and use the arrow
keys, to narrow it down to 18rem. The width is remembered in this browser. A note's details fill
the rest of the window.

## Creating, editing and deleting

Everything below writes straight to the open folder (or, in the demo, to memory). The viewer never
runs git: commit the changes in your notes repo as usual.

- **Create:** **New** in the header (or **New note, plan, daily plan or task…** in `Cmd/Ctrl+K`)
  opens a dialog preset to the current view's kind. It writes the file in the same shape the skills
  do: `notes/` and `plans/` get `YYYY-MM-DD-<slug>.md` with the `ainotes-notes` frontmatter,
  `daily/` gets `YYYY-MM-DD.md` (one per day; the dialog says so if it already exists), and
  `tasks/` gets `YYYY-MM-DD-<slug>.md` with the `ainotes-tasks` frontmatter, a `## Purpose` and a
  `## Updates` section, in the first status. Notes and plans need at least one tag; dailies are
  tagged `daily-plan` and tasks `task` automatically. The path is added under each of its tags in
  `INDEX.md` (created if missing), and a new task gets a row in `TASKS.md`'s Open table (the ledger
  is created from the skill's template if missing). The new file opens in the editor. Creating is
  hidden in a flat folder, which has no layout to create into.
- **Edit the body:** **Edit** / **Save** as before. Saving keeps the frontmatter that's on disk at
  that moment, so a tag or status changed mid-edit isn't reverted.
- **Layout:** the top row has the note's date, type and repo on the left and its buttons (Add task,
  favorite, delete, Edit, maximize) on the right; its tags are on the line below. A title that is
  the note's `# heading` is shown once, at the top of the rendered note; a task's (its frontmatter
  `title:`) shows above the body. To change a note's title, edit its `# heading` in the body.
- **Add task:** on every note, plan, daily plan, PR and agent, it opens the dialog as a task that
  points back to the item, in the `ainotes-tasks` format. A note's path goes in the task's
  `links:` and its tags become the task's starting tags. A PR goes in `prs:` and `TASKS.md`'s PRs
  cell, so the task shows under the PR's linked tasks. An agent's job, repo, worktree, state and
  last status are recorded, and any PRs it links to go in `prs:`. Each origin is also described in
  a line under `## Purpose`.
- **Maximize:** the last button hides the sidebar and the note list so the note fills the window.
  Press it again, or Esc, to go back; the sidebar returns only if it was open.
- **Deadline:** a task's detail pane has a date field next to its status; it saves when you leave
  the field (or press Enter), and × clears it. The frontmatter `deadline:` and the `TASKS.md`
  Deadline cell are updated together. Deadline changes are logged under the task's
  `## Updates`, like status changes. Task cards show `due <date>`.
- **Delete:** the trash button asks first, then deletes the file, drops it from `INDEX.md` (and any
  tag section it leaves empty) and, for a task, removes its `TASKS.md` row. `TASKS.md` itself can't
  be deleted. The viewer can't undo a delete; git can.
- **Path:** under the tags is the file's path, starting with the connected folder's name (e.g.
  `_notes/notes/2026-09-30-x.md`; `db/` follows it for an older, un-flattened repo), with a button
  that copies it.

### Unsaved changes

While a body or deadline edit is unsaved, anything that would take the note off screen
(opening another note, switching view or folder, **New**, the palette) asks first: **Save**,
**Discard** or **Keep editing**. Closing or reloading the tab gets the browser's own "Leave site?"
prompt (browsers don't allow a custom one there), and the edit is also kept in this browser's
`localStorage` as you type: the next time that note opens, it offers to **Restore** or **Discard**
the unsaved changes. The draft is cleared as soon as the edit is saved or discarded. The demo keeps
no drafts.

## Favorites

The heart in a note's detail pane favorites it (notes, plans, daily plans and tasks alike).
Favorites show a heart on their card and are listed together under **Favorites** in the Library,
newest first; the tag filter still applies there, the date range doesn't.

A favorite is the `fav` tag in the note's own frontmatter: the heart adds or removes it, as the tag
editor would, and adding or removing `fav` by hand does the same. So favorites live in the notes
repo, committed with everything else and the same in every browser and machine. A file without
frontmatter has nowhere to keep the tag, so it shows no heart. Favorites from older versions, kept
in this browser's `localStorage`, are moved into tags the first time the folder opens.

## Agents

A running agent (status **Working**) shows a spinner on its status chip, in the list and in its
detail pane; one that needs you keeps the animated **Needs you** chip.

## Pull requests

**Pull requests** in the sidebar's Library lists the PRs in `PRS.md`, in the same list and
detail panes the notes use.

- **List:** PRs are grouped by repo and sorted by number. Each row shows the PR title,
  `repo#number`, the Jira key, and compact hints from the Detail table: CI status, review state
  (changes requested / approved), behind base or merge conflicts, unresolved comment count, and how
  long it's been open and since its last commit.
- **Filters:** the chips above the list switch between **Pending** (the default), **Merged** and
  **Closed**, each with its count, and narrow the list to one repo. Neither the date range nor the
  tag filter applies to PRs, so both are hidden in this view.
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
