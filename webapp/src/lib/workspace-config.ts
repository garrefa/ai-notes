// Reads the parts of a workspace's .ai-notes/config.yml the viewer cares about:
// where the notes repo lives, and the task statuses tasks can move through.

export interface TaskStatus {
  key: string
  label: string
  color: string
  // Finished statuses: hidden by the default task filter, and listed under
  // TASKS.md's "Completed" table rather than "Open".
  closed: boolean
}

export interface WorkspaceConfig {
  notesRepo: string
  // Ordered: the first entry is the default for new tasks.
  taskStatuses: TaskStatus[]
}

export const CONFIG_DIR = ".ai-notes"
export const CONFIG_FILE = "config.yml"
const DEFAULT_NOTES_REPO = "notes"
const FALLBACK_STATUS_COLOR = "#9ca3af"

export const DEFAULT_TASK_STATUSES: TaskStatus[] = [
  { key: "backlog", label: "Backlog", color: "#9ca3af", closed: false },
  { key: "in-progress", label: "In progress", color: "#3b82f6", closed: false },
  { key: "done", label: "Done", color: "#22c55e", closed: true },
  { key: "dropped", label: "Dropped", color: "#ef4444", closed: true },
]

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  notesRepo: DEFAULT_NOTES_REPO,
  taskStatuses: DEFAULT_TASK_STATUSES,
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim()
  if (typeof v === "number") return String(v)
  return null
}

function parseTaskStatus(entry: unknown): TaskStatus | null {
  if (!isRecord(entry)) return null
  const key = nonEmptyString(entry.key)
  if (!key) return null
  return {
    key,
    label: nonEmptyString(entry.label) ?? key,
    color: nonEmptyString(entry.color) ?? FALLBACK_STATUS_COLOR,
    closed: entry.closed === true,
  }
}

function parseTaskStatuses(value: unknown): TaskStatus[] {
  if (!Array.isArray(value)) return DEFAULT_TASK_STATUSES
  const seen = new Set<string>()
  const statuses = value
    .map(parseTaskStatus)
    .filter((s): s is TaskStatus => s !== null && !seen.has(s.key) && Boolean(seen.add(s.key)))
  return statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES
}

// Throws on malformed YAML, so the caller can decide to fall back to defaults and say so.
// The YAML parser is loaded on demand: only workspace-root folders have a config to parse.
export async function parseWorkspaceConfig(text: string): Promise<WorkspaceConfig> {
  const { parse } = await import("yaml")
  const doc: unknown = parse(text)
  if (!isRecord(doc)) return DEFAULT_WORKSPACE_CONFIG
  return {
    notesRepo: nonEmptyString(doc.notes_repo) ?? DEFAULT_NOTES_REPO,
    taskStatuses: parseTaskStatuses(doc.task_statuses),
  }
}
