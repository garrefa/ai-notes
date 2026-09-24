# ainotes-viewer

An optional, local browser viewer for an ainotes notes repo (the `notes_repo` directory from your
workspace's `.ai-notes/config.yml`). It lists and renders the notes, plans, daily plans, and tasks the
`ainotes-*` skills write, lets you filter them by date range and tag, search them with a command
palette (`Cmd/Ctrl+K`), edit a note's body or tags in place, and shows the open PRs tracked in
`PRS.md`.

There is no server component: the app runs entirely in the browser and reads the notes repo straight
from disk through the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API).
It needs a Chromium-based browser (Chrome, Edge, Arc, Brave) with `showDirectoryPicker` and
`FileSystemObserver` support; other browsers show an "unsupported" state instead of the connect button.

## Run it

Requires a current Node.js LTS (20.19+ or 22+), as Vite 8 does.

```bash
cd webapp
npm install
npm run dev        # starts Vite on http://localhost:5173
```

Or build a static bundle and preview it locally:

```bash
npm run build      # outputs to webapp/dist/
npm run preview
```

## Point it at a notes repo

1. Open the app and click **Connect folder** in the sidebar.
2. In the folder picker, choose the notes repo itself — `<workspace-root>/<notes_repo>`, e.g.
   `~/work/notes` — not the workspace root.
3. Grant read/write access when the browser asks. Write access is only used when you edit a note's
   body or tags from the viewer.

The app expects the layout the `ainotes-*` skills create (see `templates/notes-repo/`):

```
<notes_repo>/
  notes/     dated notes (YYYY-MM-DD-*.md)
  plans/     dated plans
  daily/     daily plans (YYYY-MM-DD.md)
  tasks/     one file per task
  PRS.md     PR ledger: the "Pending (open)" table, plus the optional
             "Pending — Detail" table that tools/check-prs.sh generates
```

Missing directories are simply skipped. The chosen folder is remembered (in IndexedDB) and the view
refreshes live as files change on disk. If the browser drops the permission between visits, click
**Reconnect** to grant it again, or **Change folder** to switch to a different notes repo.

## Development

```bash
npm run lint       # oxlint
npm run build      # type-check (tsc -b) + production build
```
