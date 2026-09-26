#!/usr/bin/env node
// Mirrors the ainotes Claude Code toolkit — install.sh plus the skills/, agents/, hooks/,
// templates/ and tools/ it copies from — into webapp/toolkit/, so it ships inside the published
// ainotes-viewer npm package. That makes the whole toolkit installable with no clone:
//
//   npx ainotes-viewer install ~/projects/my-workspace     (runs toolkit/install.sh)
//   npx ainotes-viewer snapshot-agents                     (runs toolkit/tools/snapshot-agents.sh)
//   npx ainotes-viewer check-prs                           (runs toolkit/tools/check-prs.sh)
//
// install.sh resolves everything relative to its own location ($SRC), so keeping the same layout
// under toolkit/ is all it takes — install.sh itself is copied unmodified. npm's "files" field
// can't point outside the package root, hence the copy.
//
// webapp/toolkit/ is generated (gitignored) and never hand-edited: the repo root stays the single
// source of truth. Run via `npm run copy-toolkit` (wired into prepublishOnly).
//
// tools/release.sh is left out: it cuts releases of this repo and means nothing in a workspace.

import { chmodSync, copyFileSync, cpSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")
const destDir = join(here, "..", "toolkit")

const DIRECTORIES = ["skills", "agents", "hooks", "templates"]
const EXCLUDED_TOOLS = new Set(["release.sh"])

// Two fixups npm packing needs, applied to every file under toolkit/:
// - npm keeps whatever mode bits exist at pack time, so scripts are made executable explicitly
//   rather than trusting every platform's copy to preserve them;
// - npm always drops files named .gitignore from a tarball (templates/notes-repo/ has one, and it's
//   what keeps AGENTS.json out of the notes repo's git), so each is shipped as "gitignore" and
//   install.sh puts the dot back when it copies the templates into a workspace.
function prepareForPacking(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) prepareForPacking(path)
    else if (name.endsWith(".sh")) chmodSync(path, 0o755)
    else if (name === ".gitignore") renameSync(path, join(dir, "gitignore"))
  }
}

rmSync(destDir, { recursive: true, force: true })
mkdirSync(destDir, { recursive: true })

copyFileSync(join(repoRoot, "install.sh"), join(destDir, "install.sh"))
for (const dir of DIRECTORIES) {
  cpSync(join(repoRoot, dir), join(destDir, dir), { recursive: true })
}
cpSync(join(repoRoot, "tools"), join(destDir, "tools"), {
  recursive: true,
  filter: (src) => !EXCLUDED_TOOLS.has(src.split(/[/\\]/).pop()),
})
prepareForPacking(destDir)

console.log(`copy-toolkit: mirrored install.sh, ${[...DIRECTORIES, "tools"].join("/, ")}/ into webapp/toolkit/`)
