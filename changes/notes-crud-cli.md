- New `tools/notes.sh` (also `npx ainotes-viewer notes ...`): a command line for the notes repo. The
  repo is the folder named by the `AINOTES_DIR` environment variable, so it works from any
  directory and in scripts.
  - `list`, `search` and `show` cover every file in the notes repo (notes, plans, daily, reviews,
    tasks, the support KB, the root ledgers), not only `notes/` and `plans/`. `list` filters by
    `--kind` (folder or `root`), `--type note|plan`, `--tag`, `--repo` and `--name`.
  - `search PATTERN` looks inside file contents (fixed text, case-insensitive; `--regex`, `--case`,
    `--files` to list matching files only) with the same filters, and prints `path:line:text`.
  - A file's title is its `# ` heading, else its first heading of any level, else its filename, so
    no row is blank. Only markdown files are read for headings.
  - `create`, `update` and `delete` handle `notes/*.md` and `plans/*.md` and follow the `ax-notes`
    rules: dated filename, frontmatter, `# title` line, at least one tag, an `INDEX.md` entry under
    each tag, and a plan's body stays immutable. Other folders and the ledgers are read-only here.
  - Each write commits only the files it touched and never pushes; `--no-commit` leaves it to you.
    `delete` needs `--yes`.
  - `--json` on `list`, `search` and `show`.
