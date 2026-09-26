#!/usr/bin/env node
// Copies the two ainotes-aware, no-LLM-needed tools (and their shared helper) from the repo's own
// tools/ into webapp/tools/ so they ship inside the published ainotes-viewer npm package —
// `npx ainotes-viewer snapshot-agents` / `check-prs` (see bin/cli.js) need the real files, not a
// package.json "files" entry pointing outside the package root, which npm doesn't support.
//
// webapp/tools/ is generated (gitignored) and never hand-edited: the single source of truth stays
// ../tools/ at the repo root. Run via `npm run copy-tools` (wired into prepublishOnly).
//
// Deliberately excludes tools/release.sh (maintainer-only; assumes a full clone of this repo) and
// tools/clean-merged-worktrees.sh (a generic git-worktree utility, not ainotes-workspace-aware) —
// only the two scripts that read .ai-notes/config.yml and operate on a notes repo ship here.

import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, "..", "..", "tools")
const destDir = join(here, "..", "tools")

const FILES = ["ainotes-config.sh", "check-prs.sh", "snapshot-agents.sh"]

rmSync(destDir, { recursive: true, force: true })
mkdirSync(destDir, { recursive: true })

for (const name of FILES) {
  const dest = join(destDir, name)
  copyFileSync(join(srcDir, name), dest)
  chmodSync(dest, 0o755)
}

console.log(`copy-tools: copied ${FILES.length} files to webapp/tools/`)
