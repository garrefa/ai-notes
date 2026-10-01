import { addToIndex, EMPTY_INDEX, INDEX_FILE, removeFromIndex } from "@/lib/index-file"
import type { NewEntry } from "@/lib/new-entry"
import {
  localIsoDate,
  parseFrontmatter,
  toNote,
  sortNotes,
  withAppendedUpdate,
  withUpdatedScalar,
  withUpdatedStatus,
  type Note,
  type NoteSource,
} from "@/lib/notes-frontmatter"
import {
  appendLedgerRow,
  EMPTY_CELL,
  EMPTY_TASKS_LEDGER,
  escapeCell,
  removeLedgerRow,
  taskFileLink,
  updateLedgerCells,
  updateLedgerStatus,
  type LedgerUpdateResult,
} from "@/lib/tasks-ledger"
import type { TaskPrRef } from "@/lib/task-origin"
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
// - "repo-root": the (current, flattened) notes repo root was picked; data lives directly here
// - "legacy-db": an older, un-flattened repo — data lives in its db/ subfolder
// - "db-folder": the db/ subfolder of an older repo was picked directly
// - "flat":      none of the above — an arbitrary folder with no notes/plans/db structure.
//                Every .md file anywhere under it is read as a note (loadAllNotesFlat), and the
//                UI disables tag/date filtering, since there's no convention to filter by.
export type DataLayout = "repo-root" | "legacy-db" | "db-folder" | "flat"

export interface ResolvedWorkspace {
  dir: FileSystemDirectoryHandle
  layout: DataLayout
}

// A note's path as shown to the user: the picked folder's name, then the path inside it (e.g.
// "_notes/notes/2026-09-30-x.md"). The data dir is the picked folder, except for an older repo whose
// data sits in its db/ subfolder; when the db/ folder itself was picked, its name already says so.
export function displayPath(folderName: string, notePath: string, layout: DataLayout | null): string {
  const dataDir = layout === "legacy-db" ? `${LEGACY_DATA_DIR_NAME}/` : ""
  return `${folderName}/${dataDir}${notePath}`
}

export function isTasksLedger(notePath: string): boolean {
  return notePath === TASKS_LEDGER_FILE
}

function isTaskPath(notePath: string): boolean {
  return notePath.startsWith("tasks/")
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
  return { dir: picked, layout: "flat" }
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

// Directory names skipped by loadAllNotesFlat, on top of every dotfile/dot-directory: junk that's
// certain to be irrelevant and, for node_modules, potentially huge — picking the wrong folder by
// mistake shouldn't mean walking a dependency tree.
const FLAT_IGNORED_DIR_NAMES = new Set(["node_modules"])

async function collectMarkdownFilesFlat(dir: FileSystemDirectoryHandle, prefix: string, out: Note[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue
    const relPath = prefix ? `${prefix}/${name}` : name
    if (handle.kind === "directory") {
      if (FLAT_IGNORED_DIR_NAMES.has(name)) continue
      await collectMarkdownFilesFlat(handle as FileSystemDirectoryHandle, relPath, out)
    } else if (name.endsWith(".md")) {
      const file = await (handle as FileSystemFileHandle).getFile()
      // Tagged "notes" (not derived from any real notes/ folder) so the flat layout shows
      // everything in one list, under the same view a real notes/ folder's files would use.
      out.push(toNote(relPath, "notes", await file.text(), file.lastModified))
    }
  }
}

// Flat layout: no notes/plans/db convention to rely on, so every .md file anywhere under the
// picked folder is read as a note, `path` is its real relative path (however deep), and there's no
// separate ledger to load — TASKS.md, if one happens to exist, is just another matched file.
export async function loadAllNotesFlat(dataDir: FileSystemDirectoryHandle): Promise<Note[]> {
  await assertReadableDirectory(dataDir)
  const notes: Note[] = []
  await collectMarkdownFilesFlat(dataDir, "", notes)
  return sortNotes(notes)
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

// A note path is "<dir>/<file>.md", a bare "<file>.md" for ledger files at the data dir's root, or
// (flat layout only) an arbitrarily nested "<a>/<b>/.../<file>.md".
async function getNoteParent(dataDir: FileSystemDirectoryHandle, notePath: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = notePath.split("/")
  if (parts.length < 1 || parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error(`Not a valid note path: ${notePath}`)
  }
  let dir = dataDir
  for (const segment of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create: false })
  }
  return { dir, name: parts[parts.length - 1] }
}

async function getNoteFileHandle(dataDir: FileSystemDirectoryHandle, notePath: string): Promise<FileSystemFileHandle> {
  const { dir, name } = await getNoteParent(dataDir, notePath)
  return dir.getFileHandle(name, { create: false })
}

async function writeFile(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

async function fileExistsIn(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  return (await getFileIn(dir, name)) !== null
}

async function readNote(dataDir: FileSystemDirectoryHandle, notePath: string): Promise<string> {
  const file = await (await getNoteFileHandle(dataDir, notePath)).getFile()
  return file.text()
}

export async function saveNote(dataDir: FileSystemDirectoryHandle, notePath: string, content: string): Promise<void> {
  await writeFile(await getNoteFileHandle(dataDir, notePath), content)
}

// Replaces a note's body, keeping the frontmatter that's on disk now (so a tag or status change
// made while the body was being edited isn't reverted by saving the body).
export async function saveNoteBody(dataDir: FileSystemDirectoryHandle, notePath: string, body: string): Promise<void> {
  const { rawFrontmatter } = parseFrontmatter(await readNote(dataDir, notePath))
  await saveNote(dataDir, notePath, rawFrontmatter + body)
}

// Rewrites (or creates) a ledger/index file at the data dir's root.
async function writeRootFile(dataDir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  await writeFile(await dataDir.getFileHandle(name, { create: true }), content)
}

// Applies `edit` to TASKS.md when it exists, rewriting it only when the edit changed it. Returns a
// non-blocking notice when the ledger is missing or couldn't be (fully) updated.
async function editLedger(
  dataDir: FileSystemDirectoryHandle,
  edit: (markdown: string) => LedgerUpdateResult,
): Promise<string | null> {
  const ledger = await getFileIn(dataDir, TASKS_LEDGER_FILE)
  if (!ledger) return "TASKS.md wasn't found, so only the task file was updated."
  const text = await ledger.text()
  const result = edit(text)
  if (result.markdown === text) return result.problem && `${result.problem} Only the task file was updated.`
  await writeRootFile(dataDir, TASKS_LEDGER_FILE, result.markdown)
  return result.problem
}

async function editIndex(dataDir: FileSystemDirectoryHandle, edit: (markdown: string) => string, createIfMissing: boolean) {
  const file = await getFileIn(dataDir, INDEX_FILE)
  if (!file && !createIfMissing) return
  const text = file ? await file.text() : EMPTY_INDEX
  const next = edit(text)
  if (next !== text || !file) await writeRootFile(dataDir, INDEX_FILE, next)
}

// A file name of the entry's that isn't taken yet in its folder.
async function freeFileName(dir: FileSystemDirectoryHandle, entry: NewEntry): Promise<string> {
  for (let attempt = 1; attempt < 100; attempt++) {
    const name = entry.fileName(attempt)
    if (name === null) break
    if (!(await fileExistsIn(dir, name))) return name
  }
  throw new Error(`${entry.fileName(1)} already exists in ${entry.source}/.`)
}

export interface CreatedEntry {
  path: string
  notice: string | null
}

// What a new task's TASKS.md row needs beyond its file path.
export interface NewTaskRow {
  title: string
  created: string
  deadline: string | null
  status: Pick<TaskStatus, "key" | "closed">
  // PRs the task references from the start (an "Add task" on a PR or agent); links in the PRs cell.
  prs?: TaskPrRef[]
}

// Writes a new note/plan/daily/task file, indexes it under its tags in INDEX.md (created if the
// repo has none yet) and, for a task, appends its row to TASKS.md's Open table (the ledger is
// created from the ainotes-tasks template when missing).
export async function createEntry(
  dataDir: FileSystemDirectoryHandle,
  entry: NewEntry,
  task: NewTaskRow | null,
): Promise<CreatedEntry> {
  const dir = await dataDir.getDirectoryHandle(entry.source, { create: true })
  const name = await freeFileName(dir, entry)
  await writeFile(await dir.getFileHandle(name, { create: true }), entry.content)
  const path = `${entry.source}/${name}`

  // The file exists from here on: a failure updating INDEX.md or TASKS.md becomes a notice, so
  // "try again" doesn't create a second copy.
  try {
    await editIndex(dataDir, (markdown) => addToIndex(markdown, path, entry.tags), true)
  } catch (e) {
    return { path, notice: `${path} was created, but INDEX.md couldn't be updated (${errorText(e)}).` }
  }

  if (!task) return { path, notice: null }
  try {
    const ledgerFile = await getFileIn(dataDir, TASKS_LEDGER_FILE)
    const ledger = ledgerFile ? await ledgerFile.text() : EMPTY_TASKS_LEDGER
    const result = appendLedgerRow(
      ledger,
      {
        Task: escapeCell(task.title),
        Status: task.status.key,
        Created: task.created,
        Deadline: task.deadline ?? EMPTY_CELL,
        Jira: EMPTY_CELL,
        PRs: task.prs?.length ? task.prs.map((p) => `[${escapeCell(p.ref)}](${p.url})`).join(", ") : EMPTY_CELL,
        File: taskFileLink(path),
      },
      task.status.closed,
    )
    if (result.markdown !== ledger || !ledgerFile) await writeRootFile(dataDir, TASKS_LEDGER_FILE, result.markdown)
    return { path, notice: result.problem && `${result.problem} The task file was created, but TASKS.md has no row for it.` }
  } catch (e) {
    return { path, notice: `${path} was created, but TASKS.md couldn't be updated (${errorText(e)}).` }
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Deletes a note/plan/daily/task file, its INDEX.md entries and, for a task, its TASKS.md row
// (skipped for a flat folder, which has no INDEX.md/TASKS.md convention). A file that's already
// gone still gets its entries cleaned up, so retrying after a partial failure finishes the job.
// The TASKS.md ledger itself is never deleted from the viewer.
export async function deleteEntry(dataDir: FileSystemDirectoryHandle, notePath: string, conventions = true): Promise<void> {
  if (conventions && isTasksLedger(notePath)) throw new Error("TASKS.md is the task ledger and can't be deleted from the viewer.")
  const { dir, name } = await getNoteParent(dataDir, notePath)
  try {
    await dir.removeEntry(name)
  } catch (e) {
    if (!isMissingEntryError(e)) throw e
  }
  if (!conventions) return
  await editIndex(dataDir, (markdown) => removeFromIndex(markdown, notePath), false)
  if (isTaskPath(notePath)) await editLedger(dataDir, (markdown) => removeLedgerRow(markdown, notePath))
}

// Sets (or, with null, clears) a task's `deadline:`, logs the change under its "## Updates" and
// mirrors it into its TASKS.md row. A problem with the ledger comes back as a notice.
export async function setTaskDeadline(
  dataDir: FileSystemDirectoryHandle,
  taskPath: string,
  deadline: string | null,
  today = localIsoDate(),
): Promise<{ notice: string | null }> {
  const { body, rawFrontmatter } = parseFrontmatter(await readNote(dataDir, taskPath))
  const fm = withUpdatedScalar(rawFrontmatter || "---\n---\n", "deadline", deadline ?? "null")
  const update = deadline ? `deadline → ${deadline}` : "deadline cleared"
  await saveNote(dataDir, taskPath, fm + withAppendedUpdate(body, `${today}: ${update}`))
  const cells = { Deadline: deadline ?? EMPTY_CELL }
  return { notice: await editLedger(dataDir, (markdown) => updateLedgerCells(markdown, taskPath, cells)) }
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
  return { notice: await editLedger(dataDir, (markdown) => updateLedgerStatus(markdown, taskPath, status, today)) }
}
