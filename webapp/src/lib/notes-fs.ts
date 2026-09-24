import { localIsoDate, parseFrontmatter, toNote, sortNotes, withAppendedUpdate, withUpdatedStatus, type Note, type NoteSource } from "@/lib/notes-frontmatter"
import { FolderUnavailableError } from "@/lib/folder-errors"
import { updateLedgerStatus } from "@/lib/tasks-ledger"
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_WORKSPACE_CONFIG,
  parseWorkspaceConfig,
  type TaskStatus,
  type WorkspaceConfig,
} from "@/lib/workspace-config"

// Every note path below is relative to the workspace's *data dir* — see resolveWorkspace.
const WATCHED_DIRS: NoteSource[] = ["notes", "plans", "daily", "tasks"]
const DATA_DIR_NAME = "db"
const LEGACY_MARKER_DIRS = ["notes", "plans"]
// Ledger files that sit at the data dir's root rather than inside one of WATCHED_DIRS.
const PRS_FILE = "PRS.md"
const TASKS_LEDGER_FILE = "TASKS.md"
// "Doesn't exist (or isn't a directory)" — the only errors a lookup of an optional child may swallow.
const MISSING_ENTRY_ERRORS = new Set(["NotFoundError", "TypeMismatchError"])

// How the picked folder maps onto the data dir:
// - "workspace-root": a workspace root with .ai-notes/config.yml; data lives in <notes_repo>/db
// - "repo-root":      the notes repo root was picked; data lives in its db/ subfolder
// - "db-folder":      the db/ folder itself was picked
// - "legacy":         an older repo with notes/, plans/, ... directly at its root
// - "unrecognized":   none of the above; treated as the data dir, but likely the wrong folder
export type DataLayout = "workspace-root" | "repo-root" | "db-folder" | "legacy" | "unrecognized"

export interface ResolvedWorkspace {
  dir: FileSystemDirectoryHandle
  layout: DataLayout
  config: WorkspaceConfig
  // Non-fatal problem worth telling the user about (e.g. an unparseable config.yml).
  warning: string | null
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

// Within a notes repo (or its db/ folder): prefer db/, fall back to the legacy root layout.
async function resolveNotesRepo(repo: FileSystemDirectoryHandle): Promise<Pick<ResolvedWorkspace, "dir" | "layout">> {
  const dbDir = await getSubdirectory(repo, DATA_DIR_NAME)
  if (dbDir) return { dir: dbDir, layout: "repo-root" }
  if (repo.name === DATA_DIR_NAME) return { dir: repo, layout: "db-folder" }
  if (await hasAnySubdirectory(repo, LEGACY_MARKER_DIRS)) return { dir: repo, layout: "legacy" }
  return { dir: repo, layout: "unrecognized" }
}

async function readWorkspaceConfig(picked: FileSystemDirectoryHandle): Promise<{ text: string } | null> {
  const configDir = await getSubdirectory(picked, CONFIG_DIR)
  if (!configDir) return null
  const file = await getFileIn(configDir, CONFIG_FILE)
  return file ? { text: await file.text() } : null
}

async function getNestedDirectory(root: FileSystemDirectoryHandle, relPath: string): Promise<FileSystemDirectoryHandle> {
  const parts = relPath.split("/").filter(Boolean)
  if (parts.length === 0 || parts.some((p) => p === "." || p === "..")) {
    throw new Error(`notes_repo "${relPath}" must be a folder inside the workspace.`)
  }
  let dir = root
  for (const part of parts) {
    const next = await getSubdirectory(dir, part)
    if (!next) throw new FolderUnavailableError("missing", `The notes repo "${relPath}" (notes_repo in ${CONFIG_DIR}/${CONFIG_FILE}) wasn't found in this workspace.`)
    dir = next
  }
  return dir
}

// Accepts a workspace root (.ai-notes/config.yml → <notes_repo>/db), a notes repo root, its db/
// folder, or a legacy repo. Throws if the picked folder itself can't be read.
export async function resolveWorkspace(picked: FileSystemDirectoryHandle): Promise<ResolvedWorkspace> {
  await assertReadableDirectory(picked)
  const configFile = await readWorkspaceConfig(picked)
  if (!configFile) {
    return { ...(await resolveNotesRepo(picked)), config: DEFAULT_WORKSPACE_CONFIG, warning: null }
  }

  let config = DEFAULT_WORKSPACE_CONFIG
  let warning: string | null = null
  try {
    config = await parseWorkspaceConfig(configFile.text)
  } catch (e) {
    warning = `Couldn't parse ${CONFIG_DIR}/${CONFIG_FILE} (${e instanceof Error ? e.message : "invalid YAML"}); using default settings.`
  }
  const repo = await getNestedDirectory(picked, config.notesRepo)
  const resolved = await resolveNotesRepo(repo)
  return { dir: resolved.dir, layout: resolved.layout === "unrecognized" ? "unrecognized" : "workspace-root", config, warning }
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
  status: TaskStatus,
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
