# AINotes viewer

An optional, local browser viewer for AINotes notes repos (the `notes_repo` directory from your
workspace's `.ai-notes/config.yml`). It lists and renders the notes, plans, daily plans, and tasks the
`ainotes-*` skills write, lets you filter them by date range and tag, search them with a command
palette (`Cmd/Ctrl+K`), edit a note's body or tags in place, and shows the open PRs tracked in
`PRS.md`. Tasks show their status as a colored dot and can be moved between statuses from the
viewer. You can track several workspaces at once and switch between them in one click.

There is no server component: the app runs entirely in the browser and reads the notes repo straight
from disk through the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API).

## Requirements

- **Node.js 20.19+ or 22.12+** (what Vite 8 requires; any current LTS works).
- **A Chromium-based browser** (Chrome 133+, Edge, Arc, Brave) with `showDirectoryPicker` and
  `FileSystemObserver` support. Other browsers show an "unsupported" message instead of the
  connect button.

## Run it

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

## Connect your workspaces

1. Open the app and click **Connect folder** in the sidebar.
2. In the folder picker, choose your **workspace root**: the folder that contains
   `.ai-notes/config.yml`. The viewer reads `notes_repo` from that config (default `notes`) and opens
   `<workspace-root>/<notes_repo>/db/`. It also uses the config's `task_statuses`.
   You can also pick a notes repo directly, or its `db/` folder. There's no config in that case, so
   the default task statuses apply.
3. Grant read/write access when the browser asks. Write access is only used when you edit a note's
   body, tags or a task's status from the viewer.

### Several repos, fast switching

- **Add another workspace:** open the folder switcher at the top of the sidebar (it shows the current
  folder's name) and choose **Add folder…**. Picking a folder that's already tracked just switches to
  it.
- **Switch:** choose a folder from the same menu, or press `Cmd/Ctrl+K` and pick
  **Switch to &lt;name&gt;**. Switching clears the selected note, filters and search, so nothing
  carries over from one repo to another.
- **Rename, locate or remove:** use the `›` next to a folder in the switcher. **Rename…** only
  changes the name shown in the app (it defaults to the folder's name, so rename a folder you picked
  as `db/`). **Locate…** points the entry at a folder that moved. **Remove from list** makes the app
  forget the folder. Nothing on disk is touched.

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

Notes repos keep all their data under `db/` (see `templates/notes-repo/`):

```
<notes_repo>/
  db/
    notes/     dated notes (YYYY-MM-DD-*.md)
    plans/     dated plans
    daily/     daily plans (YYYY-MM-DD.md)
    tasks/     one file per task
    INDEX.md   tag index (maintained by ainotes-notes)
    PRS.md     PR ledger: the "Pending (open)" table, plus the optional
               "Pending — Detail" table that tools/check-prs.sh generates
    TASKS.md   task ledger (shown in the Tasks view with the task files)
```

Whether you pick the repo root or `db/` itself, the viewer reads and writes everything (note edits,
`PRS.md`, tasks, daily plans) inside `db/`. Older repos without a `db/` folder, with `notes/` and
`plans/` directly at the root, still work: the root is used as the data folder. Missing directories
are simply skipped.

## Task statuses

Each task file in `db/tasks/` has a frontmatter `status:`. The allowed statuses come from
`task_statuses` in `.ai-notes/config.yml`, in order. The first one is the default for new tasks, and
the `closed: true` ones count as finished:

```yaml
task_statuses:
  - { key: backlog,     label: Backlog,     color: "#9ca3af" }
  - { key: in-progress, label: In progress, color: "#3b82f6" }
  - { key: done,        label: Done,        color: "#22c55e", closed: true }
  - { key: dropped,     label: Dropped,     color: "#ef4444", closed: true }
```

These are the defaults when there's no config or it has no `task_statuses`. Older values still work:
`open` counts as the first non-closed status, and `done` (if there's no `done` key) as the first
closed one. Any other unknown value shows as a gray dot with its raw text.

- Every task in a list shows a dot in its status color (hover it for the label). Statuses are
  separate from tags.
- In the Tasks view, the **Status** filter picks which statuses to show. By default it shows every
  status that isn't closed.
- In a task's detail pane, the status button changes the status. That rewrites only the `status:`
  line of the task file, adds `- YYYY-MM-DD: status → <label>` under its `## Updates` section (if it
  has one), and updates the task's row in `db/TASKS.md`. A task that moves between open and closed
  moves between the Open and Completed tables, and its Completed date is set or cleared. If
  `TASKS.md` or the row is missing, only the task file is updated and the viewer says so.

## Development

```bash
npm run lint       # oxlint
npm run build      # type-check (tsc -b) + production build
```
