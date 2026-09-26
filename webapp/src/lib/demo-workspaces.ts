// Sample workspaces for trying the viewer without connecting a folder. Their files live under
// src/demo/<workspace>/ in the same layout a real notes repo uses (notes/, plans/, PRS.md,
// AGENTS.json, ...) and are served from memory (see memory-fs.ts), so edits last until the page
// reloads and nothing is ever written to disk or saved in the folder list.

import type { Workspace } from "@/lib/idb-handle"
import { createMemoryDirectory } from "@/lib/memory-fs"
import { localIsoDate } from "@/lib/notes-frontmatter"

// The fixtures are written as if today were this date. Every YYYY-MM-DD in them (file names and
// contents) is shifted by the same number of days on load, so the demo always looks recent:
// "yesterday's" daily plan stays yesterday's and PR ages keep matching their opened dates.
const FIXTURE_TODAY = "2026-03-18"
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g
const DAY_MS = 86_400_000

interface DemoDefinition {
  id: string
  label: string
  folder: string
}

// Listed in the order they appear in the folder switcher; the first one opens first.
const DEMO_DEFINITIONS: DemoDefinition[] = [
  { id: "demo:work", label: "Work", folder: "work" },
  { id: "demo:personal", label: "Personal", folder: "personal" },
]

// Markdown notes and ledgers, plus the AGENTS.json agent snapshot.
const FIXTURES = import.meta.glob<string>(["../demo/**/*.md", "../demo/**/*.json"], { query: "?raw", import: "default", eager: true })

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

function shiftDates(text: string, offsetDays: number): string {
  if (offsetDays === 0) return text
  return text.replace(ISO_DATE_RE, (match, y: string, m: string, d: string) => {
    const shifted = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) + offsetDays * DAY_MS)
    return Number.isNaN(shifted.getTime()) ? match : shifted.toISOString().slice(0, 10)
  })
}

// "../demo/work/notes/x.md" → { folder: "work", path: "notes/x.md" }
function splitFixturePath(modulePath: string): { folder: string; path: string } {
  const [folder, ...rest] = modulePath.replace(/^\.\.\/demo\//, "").split("/")
  return { folder, path: rest.join("/") }
}

function fixtureFilesFor(folder: string, offsetDays: number): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [modulePath, content] of Object.entries(FIXTURES)) {
    const fixture = splitFixturePath(modulePath)
    if (fixture.folder !== folder) continue
    files[shiftDates(fixture.path, offsetDays)] = shiftDates(content, offsetDays)
  }
  return files
}

export function isDemoWorkspace(ws: Pick<Workspace, "id">): boolean {
  return DEMO_DEFINITIONS.some((demo) => demo.id === ws.id)
}

// Fresh copies every call, so starting the demo again discards earlier edits.
export function createDemoWorkspaces(today = localIsoDate(), now = Date.now()): Workspace[] {
  const offsetDays = Math.round((utcDay(today) - utcDay(FIXTURE_TODAY)) / DAY_MS)
  return DEMO_DEFINITIONS.map((demo, index) => ({
    id: demo.id,
    label: demo.label,
    handle: createMemoryDirectory(demo.folder, fixtureFilesFor(demo.folder, offsetDays), now),
    addedAt: now,
    // Keeps the switcher's recency order matching DEMO_DEFINITIONS.
    lastOpenedAt: now - index,
  }))
}
