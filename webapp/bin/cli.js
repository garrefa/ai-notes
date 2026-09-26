#!/usr/bin/env node
// Serves the prebuilt `dist/` (this package's published output) on localhost and opens it in the
// default browser. This is what `npx ainotes-viewer@latest` runs — no clone, no npm install: npx
// always resolves `@latest` unless a version is pinned (`npx ainotes-viewer@0.2.0`), which is the
// whole update story for people who don't want to track this repo themselves.
//
// Everything the viewer does happens client-side via the File System Access API (see webapp's
// README), so this server only needs to hand back static files — same contract as `vite preview`.

import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { platform } from "node:process"
import { spawn } from "node:child_process"

const require = createRequire(import.meta.url)
const pkg = require("../package.json")

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const distDir = join(packageRoot, "dist")
const toolkitDir = join(packageRoot, "toolkit")

// Subcommands that run a script from the bundled Claude Code toolkit (see
// webapp/scripts/copy-toolkit.mjs, which mirrors the repo's install.sh, skills/, agents/, hooks/,
// templates/ and tools/ into toolkit/). Arguments pass straight through, so each behaves exactly
// like running the script from a clone.
const SUBCOMMANDS = {
  // Installs (or with --uninstall removes) the skills, agents, hooks, tools and templates into a
  // workspace's .claude/ — the no-clone equivalent of `./install.sh <workspace>`.
  install: "install.sh",
  // Both auto-discover the workspace from the current directory; run them from inside one.
  "snapshot-agents": "tools/snapshot-agents.sh",
  "check-prs": "tools/check-prs.sh",
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
}

// Opens the given URL with whatever the OS provides, without adding a dependency: `open` on
// macOS, `start` on Windows, `xdg-open` on Linux. Silently does nothing if none of those exist
// (headless/CI), since printing the URL below is always enough to proceed manually.
function openInBrowser(url) {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open"
  const args = platform === "win32" ? ["", url] : [url]
  try {
    spawn(command, args, { shell: platform === "win32", stdio: "ignore", detached: true }).unref()
  } catch {
    // Fine — the printed URL below is the fallback for every platform.
  }
}

async function resolvePath(urlPath) {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "")
  const candidate = join(distDir, safePath)
  try {
    const info = await stat(candidate)
    return info.isDirectory() ? join(candidate, "index.html") : candidate
  } catch {
    // Client-side routed path (or a typo): fall back to index.html like `vite preview` does.
    return join(distDir, "index.html")
  }
}

// Runs a bundled toolkit script via bash (regardless of the copied file's own execute bit) with
// stdio inherited, so it behaves exactly like running it from a checkout — live output, the same
// exit code, Ctrl+C reaches it, and install.sh's interactive scheduling prompt still sees a TTY.
// Resolves once the child exits.
async function runSubcommand(name, args) {
  const relPath = SUBCOMMANDS[name]
  const script = join(toolkitDir, relPath)
  try {
    await stat(script)
  } catch {
    console.error(`ainotes-viewer: missing toolkit/${relPath} — this published package is broken; please report it.`)
    process.exitCode = 1
    return
  }
  await new Promise((resolve) => {
    const child = spawn("bash", [script, ...args], { stdio: "inherit" })
    child.on("exit", (code) => {
      process.exitCode = code ?? 1
      resolve()
    })
    child.on("error", (error) => {
      console.error(`ainotes-viewer: couldn't run ${relPath}: ${error.message}`)
      process.exitCode = 1
      resolve()
    })
  })
}

function parseArgs(argv) {
  const options = { port: 4173, open: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--port" || arg === "-p") options.port = Number(argv[++i])
    else if (arg === "--no-open") options.open = false
    else if (arg === "--version" || arg === "-v") options.printVersionOnly = true
    else if (arg === "--help" || arg === "-h") options.help = true
  }
  return options
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  if (subcommand && Object.hasOwn(SUBCOMMANDS, subcommand)) {
    await runSubcommand(subcommand, rest)
    return
  }

  const options = parseArgs(process.argv.slice(2))

  if (options.printVersionOnly) {
    console.log(pkg.version)
    return
  }
  if (options.help) {
    console.log(
      [
        `ainotes-viewer v${pkg.version}`,
        "",
        "Usage: npx ainotes-viewer [--port <n>] [--no-open]",
        "       npx ainotes-viewer install <workspace-dir> [--force] [--dry-run] [--no-schedule]",
        "       npx ainotes-viewer install --uninstall <workspace-dir>",
        "       npx ainotes-viewer snapshot-agents [args...]",
        "       npx ainotes-viewer check-prs [args...]",
        "",
        "  (no subcommand)  Serve the viewer on localhost and open it in the browser.",
        "  --port, -p       Port to serve on (default: 4173)",
        "  --no-open        Don't open the default browser automatically",
        "  --version        Print the version and exit",
        "",
        "  install          Install the Claude Code toolkit (skills, agents, hooks, tools, templates)",
        "                   into <workspace-dir>/.claude/ — same as ./install.sh from a clone.",
        "  snapshot-agents  Run tools/snapshot-agents.sh (writes AGENTS.json for the Agents view).",
        "  check-prs        Run tools/check-prs.sh (the mechanical part of \"check prs\").",
        "  All three need bash (plus python3 for install, jq for the other two) and take the same",
        "  arguments as running the script from a clone — pass --help to any of them for its usage.",
        "  Run snapshot-agents and check-prs from inside the workspace so they can find it.",
      ].join("\n"),
    )
    return
  }

  try {
    await stat(distDir)
  } catch {
    console.error("ainotes-viewer: missing dist/ — this published package is broken; please report it.")
    process.exitCode = 1
    return
  }

  const server = createServer(async (req, res) => {
    try {
      const filePath = await resolvePath(decodeURIComponent(req.url ?? "/").split("?")[0])
      const body = await readFile(filePath)
      res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" })
      res.end(body)
    } catch (error) {
      res.writeHead(500)
      res.end(String(error))
    }
  })

  server.listen(options.port, () => {
    const url = `http://localhost:${options.port}`
    console.log(`ainotes-viewer v${pkg.version} → ${url}`)
    console.log("Ctrl+C to stop.")
    if (options.open) openInBrowser(url)
  })
}

main()
