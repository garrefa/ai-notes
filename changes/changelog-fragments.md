- Changelog entries are now one fragment file per PR in `changes/` instead of edits to
  `CHANGELOG.md`, so PRs open at the same time no longer conflict on it. `tools/release.sh` folds
  the fragments into the release's section and deletes them; see `changes/README.md`.
