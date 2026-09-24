import { useCallback, useEffect, useRef, useState } from "react"

import { clearStoredDirectoryHandle, getStoredDirectoryHandle, setStoredDirectoryHandle } from "@/lib/idb-handle"
import { loadAllNotes, loadPrsFile, saveNote as saveNoteToDisk } from "@/lib/notes-fs"
import type { Note } from "@/lib/notes-frontmatter"
import { parsePrs, type PendingPr } from "@/lib/prs-parser"

export type ConnectionStatus = "unsupported" | "disconnected" | "needs-permission" | "connected" | "error"

const RELOAD_DEBOUNCE_MS = 250
const PERMISSION_MODE = "readwrite"

function isSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && "FileSystemObserver" in window
}

export function useNotesDirectory() {
  const [status, setStatus] = useState<ConnectionStatus>(() => (isSupported() ? "disconnected" : "unsupported"))
  const [directoryName, setDirectoryName] = useState<string | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [prs, setPrs] = useState<PendingPr[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const observerRef = useRef<FileSystemObserver | null>(null)
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopObserving = useCallback(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
  }, [])

  const reload = useCallback(async () => {
    if (!handleRef.current) return
    try {
      const [nextNotes, prsRaw] = await Promise.all([loadAllNotes(handleRef.current), loadPrsFile(handleRef.current)])
      setNotes(nextNotes)
      setPrs(prsRaw ? parsePrs(prsRaw) : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read notes directory.")
    }
  }, [])

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(reload, RELOAD_DEBOUNCE_MS)
  }, [reload])

  const attach = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      handleRef.current = handle
      setDirectoryName(handle.name)
      setError(null)
      try {
        const [initialNotes, prsRaw] = await Promise.all([loadAllNotes(handle), loadPrsFile(handle)])
        setNotes(initialNotes)
        setPrs(prsRaw ? parsePrs(prsRaw) : null)
        setStatus("connected")
      } catch (e) {
        setStatus("error")
        setError(e instanceof Error ? e.message : "Failed to read notes directory.")
        return
      }

      stopObserving()
      const observer = new FileSystemObserver(() => scheduleReload())
      await observer.observe(handle, { recursive: true })
      observerRef.current = observer
    },
    [scheduleReload, stopObserving],
  )

  useEffect(() => {
    if (!isSupported()) return
    let cancelled = false

    ;(async () => {
      const stored = await getStoredDirectoryHandle()
      if (!stored || cancelled) return
      setDirectoryName(stored.name)
      setBusy(true)
      const permission = await stored.queryPermission({ mode: PERMISSION_MODE })
      if (cancelled) return
      if (permission === "granted") {
        await attach(stored)
      } else {
        handleRef.current = stored
        setStatus("needs-permission")
      }
      setBusy(false)
    })()

    return () => {
      cancelled = true
    }
  }, [attach])

  useEffect(() => stopObserving, [stopObserving])

  const connect = useCallback(async () => {
    setBusy(true)
    try {
      const handle = await window.showDirectoryPicker({ mode: PERMISSION_MODE })
      await setStoredDirectoryHandle(handle)
      await attach(handle)
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
      setStatus("error")
      setError(e instanceof Error ? e.message : "Failed to open the folder picker.")
    } finally {
      setBusy(false)
    }
  }, [attach])

  const reconnect = useCallback(async () => {
    if (!handleRef.current) return
    setBusy(true)
    try {
      const permission = await handleRef.current.requestPermission({ mode: PERMISSION_MODE })
      if (permission === "granted") {
        await attach(handleRef.current)
      }
    } catch (e) {
      setStatus("error")
      setError(e instanceof Error ? e.message : "Failed to reconnect the folder.")
    } finally {
      setBusy(false)
    }
  }, [attach])

  const disconnect = useCallback(async () => {
    stopObserving()
    await clearStoredDirectoryHandle()
    handleRef.current = null
    setDirectoryName(null)
    setNotes([])
    setPrs(null)
    setError(null)
    setStatus("disconnected")
  }, [stopObserving])

  const saveNote = useCallback(
    async (path: string, content: string) => {
      if (!handleRef.current) throw new Error("No folder connected.")
      await saveNoteToDisk(handleRef.current, path, content)
      await reload()
    },
    [reload],
  )

  return { status, directoryName, notes, prs, error, busy, connect, reconnect, disconnect, saveNote }
}
