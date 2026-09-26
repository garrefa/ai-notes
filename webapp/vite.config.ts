import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const packageVersion: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")).version

// Published next to index.html. A running tab polls it and offers a reload when the build ID in it
// differs from the one baked into its own bundle (see src/hooks/use-new-version.ts). The build ID,
// not the release number, is the trigger: a deploy between releases changes the code without
// changing the version. The release number rides along so the notice can name it.
const VERSION_FILE = "version.json"

function gitShortSha(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null
  } catch {
    return null
  }
}

// Unique per build, even for two builds of the same commit: the timestamp is what changes when
// someone rebuilds with local edits.
function createBuildId(builtAt: Date): string {
  const sha = gitShortSha()
  const stamp = builtAt.getTime().toString(36)
  return sha ? `${sha}-${stamp}` : stamp
}

function versionFile(version: string, buildId: string, builtAt: Date): Plugin {
  return {
    name: "ainotes-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: VERSION_FILE,
        source: JSON.stringify({ version, buildId, builtAt: builtAt.toISOString() }),
      })
    },
  }
}

const builtAt = new Date()
const buildId = createBuildId(builtAt)

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile(packageVersion, buildId, builtAt)],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __APP_VERSION_FILE__: JSON.stringify(VERSION_FILE),
    // Release number, shown in the sidebar footer, Settings and the new-version notice — kept in
    // lockstep with .claude-plugin/plugin.json by tools/release.sh.
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
