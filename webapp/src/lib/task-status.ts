// Task statuses as the viewer sees them: four built-ins, plus every other `status:` value found in
// the open workspace's task files. Colors and the "closed" flag are viewer settings (see
// status-settings.ts) layered on top of these defaults; nothing here reads workspace config.

import type { Note } from "@/lib/notes-frontmatter"

export interface TaskStatus {
  key: string
  label: string
  // A 6-digit hex color ("#rrggbb"), so it can be fed straight to <input type="color">.
  color: string
  // Finished statuses: hidden by the default task filter, and listed under TASKS.md's
  // "Completed" table rather than "Open".
  closed: boolean
}

// Per-status overrides saved by the Settings dialog. A missing field means "use the default".
export interface StatusOverride {
  color?: string
  closed?: boolean
}
export type StatusOverrides = Record<string, StatusOverride>

// A status value that isn't built in: shown with its raw value as label and a neutral gray dot.
export const UNKNOWN_STATUS_COLOR = "#a1a1aa"

// Ordered: the first entry is the status of a task with no `status:` yet.
export const BUILTIN_TASK_STATUSES: readonly TaskStatus[] = [
  { key: "backlog", label: "Backlog", color: "#9ca3af", closed: false },
  { key: "in-progress", label: "In progress", color: "#3b82f6", closed: false },
  { key: "done", label: "Done", color: "#22c55e", closed: true },
  { key: "dropped", label: "Dropped", color: "#ef4444", closed: true },
]

const BUILTIN_KEYS = new Set(BUILTIN_TASK_STATUSES.map((s) => s.key))

export function isBuiltinStatusKey(key: string): boolean {
  return BUILTIN_KEYS.has(key)
}

// Values older task files use (same mapping as the ainotes-tasks skill).
const LEGACY_STATUS_ALIASES: Record<string, string> = { open: "backlog", done: "done" }

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value)
}

// Per-task files under tasks/, as opposed to the TASKS.md ledger (also listed in the Tasks view).
export function isTaskFile(note: Note): boolean {
  return note.source === "tasks" && note.path.startsWith("tasks/")
}

function findBuiltin(value: string): TaskStatus | undefined {
  const lower = value.toLowerCase()
  const key = LEGACY_STATUS_ALIASES[lower] ?? lower
  return BUILTIN_TASK_STATUSES.find((s) => s.key === key)
}

// The key a raw `status:` value is tracked under: a built-in's key (case-insensitive, legacy
// aliases included), the empty value's default, or else the trimmed raw value itself.
export function statusKeyOf(raw: string | null): string {
  const value = raw?.trim() ?? ""
  if (!value) return BUILTIN_TASK_STATUSES[0].key
  return findBuiltin(value)?.key ?? value
}

// A status's look before any Settings override.
export function defaultTaskStatus(key: string): TaskStatus {
  return BUILTIN_TASK_STATUSES.find((s) => s.key === key) ?? { key, label: key, color: UNKNOWN_STATUS_COLOR, closed: false }
}

function withOverride(status: TaskStatus, override: StatusOverride | undefined): TaskStatus {
  if (!override) return status
  return {
    ...status,
    color: isHexColor(override.color) ? override.color : status.color,
    closed: typeof override.closed === "boolean" ? override.closed : status.closed,
  }
}

// Non-built-in status keys used by these task files.
export function discoverStatusKeys(notes: Note[]): string[] {
  const found = new Set<string>()
  for (const n of notes) {
    if (!isTaskFile(n)) continue
    const key = statusKeyOf(n.status)
    if (!BUILTIN_KEYS.has(key)) found.add(key)
  }
  return [...found]
}

// Every status the viewer offers for a workspace: built-ins first, then the discovered ones
// (alphabetically), each with the user's overrides applied.
export function buildStatusCatalog(discoveredKeys: string[], overrides: StatusOverrides): TaskStatus[] {
  const extra = [...new Set(discoveredKeys)].filter((k) => !BUILTIN_KEYS.has(k)).sort((a, b) => a.localeCompare(b))
  return [...BUILTIN_TASK_STATUSES.map((s) => s.key), ...extra].map((key) => withOverride(defaultTaskStatus(key), overrides[key]))
}

// Maps a task's raw `status:` onto the catalog. A value missing from the catalog (it shouldn't
// be, since the catalog is built from the same notes) still gets a sensible gray status.
export function resolveTaskStatus(raw: string | null, catalog: TaskStatus[]): TaskStatus {
  const key = statusKeyOf(raw)
  return catalog.find((s) => s.key === key) ?? defaultTaskStatus(key)
}

export function defaultStatusFilter(catalog: TaskStatus[]): string[] {
  return catalog.filter((s) => !s.closed).map((s) => s.key)
}
