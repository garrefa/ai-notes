import { localIsoDate, parseFrontmatter, toNote, sortNotes, withAppendedUpdate, withUpdatedStatus, type Note, type NoteSource } from "@/lib/notes-frontmatter"
import { updateLedgerStatus } from "@/lib/tasks-ledger"
import type { TaskStatus } from "@/lib/task-status"

// Every note path below is relative to the workspace's *data dir* — see resolveWorkspace.
const WATCHED_DIRS: NoteSource[] = ["notes", "plans", "daily", "tasks"]
const LEGACY_DATA_DIR_NAME = "db"
const ROOT_MARKER_DIRS = ["notes", "plans"]
// Ledger files that sit at the data dir's root rather than inside one of WATCHED_DIRS.
const PRS_FILE = "PRS.md"
const AGENTS_FILE = "AGENTS.json"
const TASKS_LEDGER_FILE = "TASKS.md"
// "Doesn't exist (or isn't a directory)" — the only errors a lookup of an optional child may swallow.
const MISSING_ENTRY_ERRORS = new Set(["NotFoundError", "TypeMismatchError"])

// How the picked folder maps onto the data dir:
// - "repo-root":    the (current, flattened) notes repo root was picked; data lives directly here
// - "legacy-db":    an older, un-flattened repo — data lives in its db/ subfolder
// - "db-folder":    the db/ subfolder of an older repo was picked directly
// - "unrecognized": none of the above; treated as the data dir, but likely the wrong folder
export type DataLayout = "repo-root" | "legacy-db" | "db-folder" | "unrecognized"

export interface ResolvedWorkspace {
  dir: FileSystemDirectoryHandle
  layout: DataLayout
}

function isMissingEntryError(e: unknown): boolean {
  return e instanceof DOMException && MISSING_ENTRY_ERRORS.has(e.name)
}

async function getSubdirectory(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name, { create: false })
  } catch (e) {
    if (isMissingEntryError(e)) return null
    throw e
  }
}

async function getFileIn(root: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    const handle = await root.getFileHandle(name, { create: false })
    return await handle.getFile()
  } catch (e) {
    if (isMissingEntryError(e)) return null
    throw e
  }
}

// Child lookups can't tell "this child is missing" from "the folder itself is gone" (both are
// NotFoundError), so the folder is probed directly first: listing a removed or unreadable
// directory throws, which the caller turns into an "unavailable" state.
export async function assertReadableDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
  for await (const _name of dir.keys()) break
}

async function hasAnySubdirectory(root: FileSystemDirectoryHandle, names: string[]): Promise<boolean> {
  const found = await Promise.all(names.map((name) => getSubdirectory(root, name)))
  return found.some(Boolean)
}

// Accepts a notes repo root with notes/plans/... directly inside it (the current layout), an older
// repo's db/ subfolder picked directly, or an older repo root whose data still lives under db/.
// Throws if the picked folder itself can't be read.
export async function resolveWorkspace(picked: FileSystemDirectoryHandle): Promise<ResolvedWorkspace> {
  await assertReadableDirectory(picked)
  if (await hasAnySubdirectory(picked, ROOT_MARKER_DIRS)) return { dir: picked, layout: "repo-root" }
  if (picked.name === LEGACY_DATA_DIR_NAME) return { dir: picked, layout: "db-folder" }
  const dbDir = await getSubdirectory(picked, LEGACY_DATA_DIR_NAME)
  if (dbDir) return { dir: dbDir, layout: "legacy-db" }
  return { dir: picked, layout: "unrecognized" }
}

async function readMarkdownFilesIn(dir: FileSystemDirectoryHandle, source: NoteSource): Promise<Note[]> {
  const notes: Note[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".md")) continue
    const fileHandle = handle as FileSystemFileHandle
    const file = await fileHandle.getFile()
    const raw = await file.text()
    notes.push(toNote(`${source}/${name}`, source, raw, file.lastModified))
  }
  return notes
}

// TASKS.md (the ainotes-tasks ledger) is listed alongside the per-task files in the Tasks view.
async function loadTasksLedger(dataDir: FileSystemDirectoryHandle): Promise<Note[]> {
  const file = await getFileIn(dataDir, TASKS_LEDGER_FILE)
  if (!file) return []
  return [toNote(TASKS_LEDGER_FILE, "tasks", await file.text(), file.lastModified)]
}

export async function loadAllNotes(dataDir: FileSystemDirectoryHandle): Promise<Note[]> {
  await assertReadableDirectory(dataDir)
  const results = await Promise.all([
    ...WATCHED_DIRS.map(async (source) => {
      const dir = await getSubdirectory(dataDir, source)
      if (!dir) return []
      return readMarkdownFilesIn(dir, source)
    }),
    loadTasksLedger(dataDir),
  ])
  return sortNotes(results.flat())
}

// PRS.md lives at the data dir's root, alongside notes/plans/daily, not inside one of them.
export async function loadPrsFile(dataDir: FileSystemDirectoryHandle): Promise<string | null> {
  const file = await getFileIn(dataDir, PRS_FILE)
  return file ? file.text() : null
}

// AGENTS.json (written by tools/snapshot-agents.sh) sits next to PRS.md at the data dir's root.
export async function loadAgentsFile(dataDir: FileSystemDirectoryHandle): Promise<string | null> {
  const file = await getFileIn(dataDir, AGENTS_FILE)
  return file ? file.text() : null
}

// A note path is "<dir>/<file>.md", or a bare "<file>.md" for ledger files at the data dir's root.
async function getNoteFileHandle(dataDir: FileSystemDirectoryHandle, notePath: string): Promise<FileSystemFileHandle> {
  const parts = notePath.split("/")
  if (parts.length > 2 || parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error(`Not a valid note path: ${notePath}`)
  }
  const dir = parts.length === 2 ? await dataDir.getDirectoryHandle(parts[0], { create: false }) : dataDir
  return dir.getFileHandle(parts[parts.length - 1], { create: false })
}

async function readNote(dataDir: FileSystemDirectoryHandle, notePath: string): Promise<string> {
  const file = await (await getNoteFileHandle(dataDir, notePath)).getFile()
  return file.text()
}

export async function saveNote(dataDir: FileSystemDirectoryHandle, notePath: string, content: string): Promise<void> {
  const fileHandle = await getNoteFileHandle(dataDir, notePath)
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

// Sets a task file's `status:` (re-read from disk so nothing else in it changes), logs the change
// under its "## Updates" section, and mirrors it into TASKS.md. Returns a non-blocking notice when
// the ledger couldn't be updated; the task file is updated regardless.
export async function setTaskStatus(
  dataDir: FileSystemDirectoryHandle,
  taskPath: string,
  status: Pick<TaskStatus, "key" | "label" | "closed">,
  today = localIsoDate(),
): Promise<{ notice: string | null }> {
  const raw = await readNote(dataDir, taskPath)
  const { frontmatter, body, rawFrontmatter } = parseFrontmatter(raw)
  if (frontmatter.status === status.key) return { notice: null }

  const nextFrontmatter = rawFrontmatter ? withUpdatedStatus(rawFrontmatter, status.key) : `---\nstatus: ${status.key}\n---\n`
  await saveNote(dataDir, taskPath, nextFrontmatter + withAppendedUpdate(body, `${today}: status → ${status.label}`))

  const ledger = await getFileIn(dataDir, TASKS_LEDGER_FILE)
  if (!ledger) return { notice: "TASKS.md wasn't found, so only the task file was updated." }
  const ledgerText = await ledger.text()
  const result = updateLedgerStatus(ledgerText, taskPath, status, today)
  if (result.markdown === ledgerText) {
    return { notice: `${result.problem} Only the task file was updated.` }
  }
  await saveNote(dataDir, TASKS_LEDGER_FILE, result.markdown)
  return { notice: result.problem }
}
