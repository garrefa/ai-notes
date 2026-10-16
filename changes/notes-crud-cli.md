- New `tools/notes.sh` (also `npx ainotes-viewer notes ...`): a CRUD command line for notes and
  plans. The notes repo is the folder named by the `AINOTES_DIR` environment variable, so it works
  from any directory and in scripts.
  - `list` (filter by `--type`, `--tag`, `--repo`; `--json`), `show`, `create`, `update` and
    `delete` take a path or a unique slug.
  - Writes follow the `ax-notes` rules: dated filename, frontmatter, `# title` line, at least one
    tag, an `INDEX.md` entry under each tag, and a plan's body stays immutable.
  - Each write commits only the files it touched and never pushes; `--no-commit` leaves it to you.
    `delete` needs `--yes`.
