// Favorited notes, plans, daily plans and tasks: note paths, kept per workspace in this browser's
// localStorage (like the Library order and status settings — nothing is written to the notes repo).
// A demo workspace's favorites live in memory only, like the rest of its edits.

import { useCallback, useMemo, useState } from "react"

const FAVORITES_KEY_PREFIX = "ainotes-favorites:"

function storageKey(workspaceId: string): string {
  return `${FAVORITES_KEY_PREFIX}${workspaceId}`
}

export function parseFavorites(text: string | null): string[] {
  if (!text) return []
  try {
    const doc: unknown = JSON.parse(text)
    return Array.isArray(doc) ? [...new Set(doc.filter((v): v is string => typeof v === "string"))] : []
  } catch {
    return []
  }
}

function loadFavorites(workspaceId: string | null): string[] {
  if (!workspaceId) return []
  try {
    return parseFavorites(localStorage.getItem(storageKey(workspaceId)))
  } catch {
    return []
  }
}

function saveFavorites(workspaceId: string, paths: string[]): void {
  try {
    if (paths.length === 0) localStorage.removeItem(storageKey(workspaceId))
    else localStorage.setItem(storageKey(workspaceId), JSON.stringify(paths))
  } catch {
    // Not persisted (storage unavailable); the change still applies for this session.
  }
}

// `workspaceId` null (nothing open) or `persist` false (a demo) keeps favorites in memory only.
export function useFavorites(workspaceId: string | null, persist: boolean) {
  const [paths, setPaths] = useState<string[]>(() => (persist ? loadFavorites(workspaceId) : []))

  const apply = useCallback(
    (update: (current: string[]) => string[]) => {
      setPaths((current) => {
        const next = update(current)
        if (persist && workspaceId) saveFavorites(workspaceId, next)
        return next
      })
    },
    [persist, workspaceId],
  )

  const toggle = useCallback(
    (path: string) => apply((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path])),
    [apply],
  )
  const forget = useCallback((path: string) => apply((current) => current.filter((p) => p !== path)), [apply])

  const favorites = useMemo(() => new Set(paths), [paths])
  return { favorites, toggle, forget }
}

export type Favorites = ReturnType<typeof useFavorites>
