import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  loadWorkspaceState,
  newWorkspace,
  saveActiveWorkspaceId,
  saveWorkspaces,
  type Workspace,
} from "@/lib/idb-handle"
import { saveNote as saveNoteToDisk, setTaskStatus, type DataLayout } from "@/lib/notes-fs"
import type { Note } from "@/lib/notes-frontmatter"
import type { PendingPr } from "@/lib/prs-parser"
import type { TaskStatus } from "@/lib/task-status"
import { toFolderUnavailable, withTimeout, type FolderUnavailableError } from "@/lib/folder-errors"
import {
  FOLDER_TIMEOUT_MS,
  loadWorkspace,
  probeFolder,
  queryFolderPermission,
  reloadWorkspace,
  type FolderAvailability,
} from "@/lib/workspace-loader"

export type ConnectionStatus = "unsupported" | "disconnected" | "needs-permission" | "connected" | "unavailable"

// A workspace as the UI sees it: no handle, plus whether it can currently be opened.
export interface WorkspaceSummary {
  id: string
  label: string
  addedAt: number
  lastOpenedAt: number
  availability: FolderAvailability
}

type OpenOutcome = "connected" | "needs-permission" | "unavailable" | "stale"

const RELOAD_DEBOUNCE_MS = 250
const PERMISSION_MODE = "readwrite"

function isSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && "FileSystemObserver" in window
}

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback
}

function byMostRecentlyOpened(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

async function findSameFolder(workspaces: Workspace[], handle: FileSystemDirectoryHandle): Promise<Workspace | null> {
  for (const ws of workspaces) {
    try {
      if (await withTimeout(ws.handle.isSameEntry(handle), FOLDER_TIMEOUT_MS)) return ws
    } catch {
      // A tracked folder that's gone can't be the one just picked.
    }
  }
  return null
}

async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: PERMISSION_MODE })
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null
    throw e
  }
}

// The watched folder itself was removed, or the browser lost track of it.
function observedRootIsGone(records: FileSystemObserverObservation[]) {
  return records.some((r) => r.type === "disappeared" && r.relativePathComponents.length === 0)
}

export function useNotesDirectory() {
  const [status, setStatus] = useState<ConnectionStatus>(() => (isSupported() ? "disconnected" : "unsupported"))
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Record<string, FolderAvailability>>({})
  const [layout, setLayout] = useState<DataLayout | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [prs, setPrs] = useState<PendingPr[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Non-blocking message (fallback to another folder, a failed save of the folder list, ...).
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const workspacesRef = useRef<Workspace[]>([])
  const activeRef = useRef<Workspace | null>(null)
  const dataDirRef = useRef<FileSystemDirectoryHandle | null>(null)
  const observerRef = useRef<FileSystemObserver | null>(null)
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped on every open/close so async work started for a previous workspace
  // (a slow directory read, a debounced reload) can tell it's stale and bail
  // instead of writing that workspace's notes into the current one.
  const generationRef = useRef(0)

  const stopObserving = useCallback(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
  }, [])

  const commitWorkspaces = useCallback(async (next: Workspace[]) => {
    workspacesRef.current = next
    setWorkspaces(next)
    try {
      await saveWorkspaces(next)
    } catch (e) {
      setNotice(errorMessage(e, "Failed to save the folder list."))
    }
  }, [])

  const setFolderAvailability = useCallback((id: string, value: FolderAvailability) => {
    setAvailability((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }))
  }, [])

  const refreshAvailability = useCallback(async () => {
    const entries = await Promise.all(workspacesRef.current.map(async (ws) => [ws.id, await probeFolder(ws.handle)] as const))
    setAvailability(Object.fromEntries(entries))
  }, [])

  // Drops everything tied to the currently open workspace, synchronously, so the
  // very next render never shows the previous workspace's notes under a new one.
  const resetWorkspaceData = useCallback(() => {
    generationRef.current++
    stopObserving()
    dataDirRef.current = null
    setLayout(null)
    setNotes([])
    setPrs(null)
    setError(null)
    setNotice(null)
  }, [stopObserving])

  // The open (or opening) folder can't be read: show why, stop watching, keep its entry.
  const markUnavailable = useCallback(
    (id: string, failure: FolderUnavailableError) => {
      stopObserving()
      dataDirRef.current = null
      setNotes([])
      setPrs(null)
      setStatus("unavailable")
      setError(failure.message)
      setFolderAvailability(id, "missing")
    },
    [setFolderAvailability, stopObserving],
  )

  const reload = useCallback(async () => {
    const dataDir = dataDirRef.current
    const ws = activeRef.current
    if (!dataDir || !ws) return
    const generation = generationRef.current
    try {
      const next = await reloadWorkspace(dataDir, ws.label)
      if (generation !== generationRef.current) return
      setNotes(next.notes)
      setPrs(next.prs)
    } catch (e) {
      if (generation !== generationRef.current) return
      markUnavailable(ws.id, toFolderUnavailable(e, ws.label))
    }
  }, [markUnavailable])

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(reload, RELOAD_DEBOUNCE_MS)
  }, [reload])

  const markOpened = useCallback(
    (id: string) => {
      const now = Date.now()
      void commitWorkspaces(workspacesRef.current.map((ws) => (ws.id === id ? { ...ws, lastOpenedAt: now } : ws)))
    },
    [commitWorkspaces],
  )

  // Opens a workspace: checks (and, when called from a user gesture, requests) permission,
  // resolves its data dir, loads it, and starts watching it. Every failure — including a
  // folder that never answers — ends in "unavailable", never an endless "Connecting…".
  const openWorkspace = useCallback(
    async (ws: Workspace, { promptForPermission }: { promptForPermission: boolean }): Promise<OpenOutcome> => {
      resetWorkspaceData()
      const generation = generationRef.current
      const isStale = () => generation !== generationRef.current

      activeRef.current = ws
      setActiveId(ws.id)
      setStatus("disconnected")
      setBusy(true)
      void saveActiveWorkspaceId(ws.id).catch(() => {})

      try {
        let permission = await queryFolderPermission(ws.handle, ws.label)
        if (permission !== "granted" && promptForPermission) {
          // Not timed: the user may take a while to answer the browser's prompt.
          permission = await ws.handle.requestPermission({ mode: PERMISSION_MODE })
        }
        if (isStale()) return "stale"
        if (permission !== "granted") {
          setFolderAvailability(ws.id, "needs-access")
          setStatus("needs-permission")
          return "needs-permission"
        }

        const loaded = await loadWorkspace(ws.handle, ws.label)
        if (isStale()) return "stale"
        dataDirRef.current = loaded.resolved.dir
        setLayout(loaded.resolved.layout)
        setNotes(loaded.notes)
        setPrs(loaded.prs)
        setStatus("connected")
        setFolderAvailability(ws.id, "available")
        markOpened(ws.id)

        const observer = new FileSystemObserver((records) => {
          if (observedRootIsGone(records)) {
            markUnavailable(ws.id, toFolderUnavailable(new DOMException("gone", "NotFoundError"), ws.label))
          } else {
            // Includes "errored" records: the reload either succeeds or marks the folder unavailable.
            scheduleReload()
          }
        })
        await withTimeout(observer.observe(loaded.resolved.dir, { recursive: true }), FOLDER_TIMEOUT_MS)
        if (isStale()) {
          observer.disconnect()
          return "stale"
        }
        observerRef.current = observer
        return "connected"
      } catch (e) {
        if (isStale()) return "stale"
        markUnavailable(ws.id, toFolderUnavailable(e, ws.label))
        return "unavailable"
      } finally {
        if (!isStale()) setBusy(false)
      }
    },
    [markOpened, markUnavailable, resetWorkspaceData, scheduleReload, setFolderAvailability],
  )

  const closeWorkspace = useCallback(() => {
    resetWorkspaceData()
    activeRef.current = null
    setActiveId(null)
    setStatus("disconnected")
    setBusy(false)
    void saveActiveWorkspaceId(null).catch(() => {})
  }, [resetWorkspaceData])

  // Opens the first candidate that's actually there. Unavailable folders are skipped (and
  // stay in the list, marked missing); with none left, the app shows its empty state.
  const openFirstAvailable = useCallback(
    async (candidates: Workspace[]) => {
      const skipped: Workspace[] = []
      for (const ws of candidates) {
        const outcome = await openWorkspace(ws, { promptForPermission: false })
        if (outcome === "stale") return
        if (outcome !== "unavailable") {
          if (skipped.length > 0) setNotice(`"${skipped[0].label}" is unavailable, so "${ws.label}" was opened instead.`)
          return
        }
        skipped.push(ws)
      }
      closeWorkspace()
      if (skipped.length > 0) {
        setNotice(`"${skipped[0].label}" is unavailable. Locate it or remove it from the folder switcher.`)
      }
    },
    [closeWorkspace, openWorkspace],
  )

  useEffect(() => {
    if (!isSupported()) return
    let cancelled = false

    ;(async () => {
      const state = await loadWorkspaceState()
      if (cancelled) return
      workspacesRef.current = state.workspaces
      setWorkspaces(state.workspaces)
      void refreshAvailability()
      const byRecency = byMostRecentlyOpened(state.workspaces)
      const initial = state.workspaces.find((ws) => ws.id === state.activeId)
      // No user gesture on load, so permission can only be checked, not requested —
      // a lapsed folder lands in "needs-permission" and shows a "Grant access" button.
      await openFirstAvailable(initial ? [initial, ...byRecency.filter((ws) => ws !== initial)] : byRecency)
    })()

    return () => {
      cancelled = true
    }
  }, [openFirstAvailable, refreshAvailability])

  useEffect(() => stopObserving, [stopObserving])

  const addWorkspace = useCallback(async () => {
    try {
      const picked = await pickFolder()
      if (!picked) return
      const existing = await findSameFolder(workspacesRef.current, picked)
      if (existing) {
        await openWorkspace(existing, { promptForPermission: true })
        return
      }
      const ws = newWorkspace(picked)
      await commitWorkspaces([...workspacesRef.current, ws])
      await openWorkspace(ws, { promptForPermission: true })
    } catch (e) {
      setNotice(errorMessage(e, "Failed to open the folder picker."))
    }
  }, [commitWorkspaces, openWorkspace])

  // Points a tracked folder (typically a missing one) at a newly picked location.
  const locateWorkspace = useCallback(
    async (id: string) => {
      const ws = workspacesRef.current.find((w) => w.id === id)
      if (!ws) return
      try {
        const picked = await pickFolder()
        if (!picked) return
        const existing = await findSameFolder(workspacesRef.current, picked)
        if (existing && existing.id !== id) {
          await openWorkspace(existing, { promptForPermission: true })
          setNotice(`That folder is already tracked as "${existing.label}".`)
          return
        }
        // Keep a custom label; follow the folder's new name if the label was just the old name.
        const label = ws.label === ws.handle.name ? picked.name : ws.label
        const relocated = { ...ws, handle: picked, label }
        await commitWorkspaces(workspacesRef.current.map((w) => (w.id === id ? relocated : w)))
        await openWorkspace(relocated, { promptForPermission: true })
      } catch (e) {
        setNotice(errorMessage(e, "Failed to open the folder picker."))
      }
    },
    [commitWorkspaces, openWorkspace],
  )

  // Must be called from a user gesture (click / keypress): if the folder's permission
  // lapsed, this is where the browser's permission prompt gets shown. Picking a folder
  // that's unavailable retries it (its drive may have been reconnected).
  const switchWorkspace = useCallback(
    async (id: string) => {
      const ws = workspacesRef.current.find((w) => w.id === id)
      if (!ws) return
      if (id === activeId && status === "connected") return
      await openWorkspace(ws, { promptForPermission: true })
    },
    [activeId, status, openWorkspace],
  )

  // "Grant access" for a lapsed permission, or "Retry" for an unavailable folder.
  const reopenActive = useCallback(async () => {
    if (activeRef.current) await openWorkspace(activeRef.current, { promptForPermission: true })
  }, [openWorkspace])

  const renameWorkspace = useCallback(
    async (id: string, label: string) => {
      await commitWorkspaces(
        workspacesRef.current.map((ws) => (ws.id === id ? { ...ws, label: label.trim() || ws.handle.name } : ws)),
      )
    },
    [commitWorkspaces],
  )

  // Only forgets the folder; nothing on disk is touched.
  const removeWorkspace = useCallback(
    async (id: string) => {
      const remaining = workspacesRef.current.filter((ws) => ws.id !== id)
      await commitWorkspaces(remaining)
      setAvailability(({ [id]: _removed, ...rest }) => rest)
      if (id !== activeRef.current?.id) return
      await openFirstAvailable(byMostRecentlyOpened(remaining))
    },
    [commitWorkspaces, openFirstAvailable],
  )

  const saveNote = useCallback(
    async (path: string, content: string) => {
      if (!dataDirRef.current) throw new Error("No folder connected.")
      await saveNoteToDisk(dataDirRef.current, path, content)
      await reload()
    },
    [reload],
  )

  // Returns a non-blocking notice when TASKS.md couldn't be updated alongside the task file.
  const updateTaskStatus = useCallback(
    async (path: string, next: TaskStatus): Promise<string | null> => {
      if (!dataDirRef.current) throw new Error("No folder connected.")
      const { notice: ledgerNotice } = await setTaskStatus(dataDirRef.current, path, next)
      await reload()
      return ledgerNotice
    },
    [reload],
  )

  const workspaceSummaries = useMemo<WorkspaceSummary[]>(
    () =>
      workspaces.map(({ id, label, addedAt, lastOpenedAt }) => ({
        id,
        label,
        addedAt,
        lastOpenedAt,
        availability: availability[id] ?? "available",
      })),
    [workspaces, availability],
  )
  const activeWorkspace = workspaceSummaries.find((ws) => ws.id === activeId) ?? null

  return {
    status,
    workspaces: workspaceSummaries,
    activeWorkspace,
    layout,
    notes,
    prs,
    error,
    notice,
    busy,
    addWorkspace,
    switchWorkspace,
    reopenActive,
    locateWorkspace,
    renameWorkspace,
    removeWorkspace,
    refreshAvailability,
    dismissNotice: () => setNotice(null),
    saveNote,
    updateTaskStatus,
  }
}

export type NotesDirectory = ReturnType<typeof useNotesDirectory>
