import { useCallback, useEffect, useRef, useState } from "react"

import { useSidebar } from "@/components/ui/sidebar"

// Escape belongs to whatever has focus when it's a field (the tag input, the body editor) or when
// a dialog is open on top (palette, settings, confirmations): those close or cancel themselves.
function escapeHandledElsewhere(e: KeyboardEvent) {
  if (e.defaultPrevented) return true
  const target = e.target as HTMLElement | null
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return true
  return document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']") !== null
}

// The open note maximized to the whole content area: the note list goes, and so does the sidebar,
// which comes back as it was (open or closed) on the way out. Escape leaves too. `available` is
// whether a note is on screen at all; maximizing ends by itself when it stops being.
export function useMaximizedNote(available: boolean) {
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()
  const [maximized, setMaximized] = useState(false)
  const sidebarWasOpen = useRef(false)

  // No note on screen any more (another view, the note deleted): back to the normal layout.
  const [seenAvailable, setSeenAvailable] = useState(available)
  if (seenAvailable !== available) {
    setSeenAvailable(available)
    if (!available) setMaximized(false)
  }

  // The sidebar follows: collapsed while maximized, reopened afterwards only if it was open before.
  useEffect(() => {
    if (maximized) {
      setSidebarOpen(false)
    } else if (sidebarWasOpen.current) {
      sidebarWasOpen.current = false
      setSidebarOpen(true)
    }
  }, [maximized, setSidebarOpen])

  const toggle = useCallback(() => {
    if (!maximized) sidebarWasOpen.current = sidebarOpen
    setMaximized(!maximized)
  }, [maximized, sidebarOpen])

  useEffect(() => {
    if (!maximized) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !escapeHandledElsewhere(e)) setMaximized(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [maximized])

  return { maximized, toggle }
}
