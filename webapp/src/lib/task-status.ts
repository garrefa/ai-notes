// Maps a task file's raw frontmatter `status:` onto the workspace's configured statuses.

import type { Note } from "@/lib/notes-frontmatter"
import type { TaskStatus } from "@/lib/workspace-config"

// Status-filter key for tasks whose status isn't one of the configured ones.
export const OTHER_STATUS_KEY = "__other__"
// Values older task files use, mapped onto the configured statuses (same rule as the ainotes-tasks skill).
const LEGACY_OPEN_STATUS = "open"
const LEGACY_DONE_STATUS = "done"

export interface ResolvedTaskStatus {
  key: string
  label: string
  // null for an unknown status, which renders as a neutral dot.
  color: string | null
  closed: boolean
  known: boolean
}

// Per-task files under tasks/, as opposed to the TASKS.md ledger (also listed in the Tasks view).
export function isTaskFile(note: Note): boolean {
  return note.source === "tasks" && note.path.startsWith("tasks/")
}

function toResolved(status: TaskStatus): ResolvedTaskStatus {
  return { ...status, known: true }
}

// A task with no status yet gets the default (first) status. The legacy "open" value maps to the
// first non-closed status, and "done" (when not configured as a key) to the first closed one.
// Anything else unrecognized is shown as-is with a neutral dot.
export function resolveTaskStatus(raw: string | null, statuses: TaskStatus[]): ResolvedTaskStatus {
  const value = raw?.trim() ?? ""
  if (!value) return toResolved(statuses[0])
  const match = statuses.find((s) => s.key === value) ?? statuses.find((s) => s.key.toLowerCase() === value.toLowerCase())
  if (match) return toResolved(match)
  const legacy = value.toLowerCase()
  const legacyMatch =
    legacy === LEGACY_OPEN_STATUS
      ? statuses.find((s) => !s.closed)
      : legacy === LEGACY_DONE_STATUS
        ? statuses.find((s) => s.closed)
        : undefined
  if (legacyMatch) return toResolved(legacyMatch)
  return { key: value, label: value, color: null, closed: false, known: false }
}

export function statusFilterKey(status: ResolvedTaskStatus): string {
  return status.known ? status.key : OTHER_STATUS_KEY
}

export function defaultStatusFilter(statuses: TaskStatus[]): string[] {
  return [...statuses.filter((s) => !s.closed).map((s) => s.key), OTHER_STATUS_KEY]
}
