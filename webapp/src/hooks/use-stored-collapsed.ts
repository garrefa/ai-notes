import { useCallback, useState } from "react"

function readStoredCollapsed(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored === "1"
  } catch {
    return fallback
  }
}

// Collapsed/expanded state for a sidebar section, remembered per browser.
export function useStoredCollapsed(key: string, collapsedByDefault = false) {
  const [collapsed, setCollapsed] = useState(() => readStoredCollapsed(key, collapsedByDefault))

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(key, next ? "1" : "0")
      } catch {
        // Not persisted (storage unavailable); the change still applies for this session.
      }
      return next
    })
  }, [key])

  return [collapsed, toggle] as const
}
