// Loads a tracked folder's data, turning every way that can fail — the folder was deleted,
// moved, renamed, sits on an unmounted drive, or simply never answers — into one
// FolderUnavailableError instead of an exception or a promise that never settles.

import { parseAgentsSnapshot, type AgentsSnapshot } from "@/lib/agents"
import {
  assertReadableDirectory,
  loadAgentsFile,
  loadAllNotes,
  loadAllNotesFlat,
  loadPrsFile,
  resolveWorkspace,
  type DataLayout,
  type ResolvedWorkspace,
} from "@/lib/notes-fs"
import type { Note } from "@/lib/notes-frontmatter"
import { parsePrLedger, type PrLedger } from "@/lib/prs-parser"
import { toFolderUnavailable, withTimeout } from "@/lib/folder-errors"

// A handle to a removed folder or an unmounted volume can stall instead of failing.
export const FOLDER_TIMEOUT_MS = 10_000
const PERMISSION_MODE = "readwrite"

export interface WorkspaceData {
  notes: Note[]
  // null when the folder has no PRS.md.
  prLedger: PrLedger | null
  // null when the folder has no AGENTS.json (or it can't be parsed).
  agents: AgentsSnapshot | null
}

// What an open workspace shows before (and after) its data is read.
export const EMPTY_WORKSPACE_DATA: WorkspaceData = { notes: [], prLedger: null, agents: null }

export interface LoadedWorkspace extends WorkspaceData {
  resolved: ResolvedWorkspace
}

export async function readWorkspaceData(dataDir: FileSystemDirectoryHandle, layout: DataLayout): Promise<WorkspaceData> {
  const [notes, prsRaw, agentsRaw] = await Promise.all([
    layout === "flat" ? loadAllNotesFlat(dataDir) : loadAllNotes(dataDir),
    loadPrsFile(dataDir),
    loadAgentsFile(dataDir),
  ])
  return {
    notes,
    prLedger: prsRaw === null ? null : parsePrLedger(prsRaw),
    agents: agentsRaw === null ? null : parseAgentsSnapshot(agentsRaw),
  }
}

async function guarded<T>(work: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  try {
    return await withTimeout(work, timeoutMs)
  } catch (e) {
    throw toFolderUnavailable(e, label)
  }
}

// Resolves the data dir and reads it. Assumes permission is already granted.
export function loadWorkspace(handle: FileSystemDirectoryHandle, label: string, timeoutMs = FOLDER_TIMEOUT_MS) {
  return guarded(
    (async (): Promise<LoadedWorkspace> => {
      const resolved = await resolveWorkspace(handle)
      return { resolved, ...(await readWorkspaceData(resolved.dir, resolved.layout)) }
    })(),
    label,
    timeoutMs,
  )
}

// Re-reads an already open workspace's data dir (after a file-watch event or a save). Needs the
// layout from the original resolveWorkspace call — a reload never re-resolves it.
export function reloadWorkspace(
  dataDir: FileSystemDirectoryHandle,
  layout: DataLayout,
  label: string,
  timeoutMs = FOLDER_TIMEOUT_MS,
) {
  return guarded(readWorkspaceData(dataDir, layout), label, timeoutMs)
}

export function queryFolderPermission(handle: FileSystemDirectoryHandle, label: string, timeoutMs = FOLDER_TIMEOUT_MS) {
  return guarded(handle.queryPermission({ mode: PERMISSION_MODE }), label, timeoutMs)
}

export type FolderAvailability = "available" | "needs-access" | "missing"

// Cheap check for the switcher: can this folder be listed right now? Without permission the
// folder can't be probed, so it's reported as needing access rather than guessed at.
export async function probeFolder(handle: FileSystemDirectoryHandle, timeoutMs = FOLDER_TIMEOUT_MS): Promise<FolderAvailability> {
  try {
    const permission = await withTimeout(handle.queryPermission({ mode: PERMISSION_MODE }), timeoutMs)
    if (permission !== "granted") return "needs-access"
    await withTimeout(assertReadableDirectory(handle), timeoutMs)
    return "available"
  } catch {
    return "missing"
  }
}
