# Pending changelog entries

Each PR adds its changelog entry as a new file here instead of editing `CHANGELOG.md`, so PRs open
at the same time never touch the same lines (and never conflict on the changelog).

- One file per PR, named after the branch or the change: `changes/viewer-richer-markdown.md`.
- The file holds the entry exactly as it should read under the release heading: one or more
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) bullets, wrapped at ~100 columns.

  ```markdown
  - Viewer: a link from one note to another opens that note in a popover over the current one.
  ```

- To change an entry before release, edit its file. To drop it, delete the file.

`tools/release.sh` folds every file here (except this README), in file-name order, into the new
version's section of `CHANGELOG.md` after any bullets already under `## [Unreleased]`, and deletes
them in the release commit.
