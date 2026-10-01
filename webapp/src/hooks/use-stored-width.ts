import { useCallback } from "react"
import type { PanelSize } from "react-resizable-panels"

function readStoredWidth(key: string): number | null {
  try {
    const stored = Number(localStorage.getItem(key))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

// A resizable panel's width in pixels, remembered per browser. Pixels rather than the library's
// percentages, so the panel comes back the same width however wide the window or the space beside
// it is (e.g. with the sidebar collapsed, or after the panel was hidden and shown again).
export function useStoredWidth(key: string, fallback: string) {
  const onResize = useCallback(
    (size: PanelSize) => {
      try {
        localStorage.setItem(key, String(Math.round(size.inPixels)))
      } catch {
        // Not persisted (storage unavailable): the panel starts from the fallback next time.
      }
    },
    [key],
  )

  // Read on every render, so a panel mounted again picks up its latest width.
  const stored = readStoredWidth(key)
  const defaultSize = stored === null ? fallback : `${stored}px`
  return { defaultSize, onResize }
}
