// Favorited notes, plans, daily plans and tasks: the ones tagged `fav` in their own frontmatter. So a
// favorite lives in the notes repo like any other tag: committed, shared across browsers and
// machines, and visible to the ainotes skills. Toggling one rewrites the file's tags, the same way
// the tag editor does.
//
// Favorites used to be kept in this browser's localStorage, per workspace. Those are moved over
// once: each one still in the folder gets the tag, and the stored list is removed.

import { useCallback, useEffect, useMemo, useRef } from "react"

import { withUpdatedTags, type Note } from "@/lib/notes-frontmatter"

export const FAVORITE_TAG = "fav"

const LEGACY_KEY_PREFIX = "ainotes-favorites:"

export function isFavorite(note: Note): boolean {
  return note.tags.includes(FAVORITE_TAG)
}

// A file without frontmatter has nowhere to keep the tag.
export function canFavorite(note: Note): boolean {
  return note.rawFrontmatter !== ""
}

// The whole file with the tag added or removed.
function withFavorite(note: Note, favorite: boolean): string {
  const tags = favorite ? [...note.tags.filter((t) => t !== FAVORITE_TAG), FAVORITE_TAG] : note.tags.filter((t) => t !== FAVORITE_TAG)
  return withUpdatedTags(note.rawFrontmatter, tags) + note.body
}

function legacyKey(workspaceId: string): string {
  return `${LEGACY_KEY_PREFIX}${workspaceId}`
}

function readLegacyFavorites(workspaceId: string): string[] {
  try {
    const doc: unknown = JSON.parse(localStorage.getItem(legacyKey(workspaceId)) ?? "[]")
    return Array.isArray(doc) ? doc.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

function forgetLegacyFavorites(workspaceId: string): void {
  try {
    localStorage.removeItem(legacyKey(workspaceId))
  } catch {
    // Storage unavailable: nothing was readable there either.
  }
}

export function useFavorites({
  notes,
  saveNote,
  workspaceId,
  onError,
}: {
  notes: Note[]
  saveNote: (path: string, content: string) => Promise<void>
  // The open folder, whose old localStorage favorites are moved into tags; null for a demo or
  // nothing open (nothing stored to move).
  workspaceId: string | null
  onError: (message: string) => void
}) {
  const favorites = useMemo(() => new Set(notes.filter(isFavorite).map((n) => n.path)), [notes])

  const toggle = useCallback(
    (path: string) => {
      const note = notes.find((n) => n.path === path)
      if (!note || !canFavorite(note)) return
      saveNote(path, withFavorite(note, !isFavorite(note))).catch(() =>
        onError(`Couldn't update favorites for ${path}: check the folder is still connected.`),
      )
    },
    [notes, saveNote, onError],
  )

  // One-time move of this folder's localStorage favorites into `fav` tags, once its notes are loaded.
  const migrated = useRef<string | null>(null)
  useEffect(() => {
    if (!workspaceId || notes.length === 0 || migrated.current === workspaceId) return
    migrated.current = workspaceId
    const pending = readLegacyFavorites(workspaceId)
      .map((path) => notes.find((n) => n.path === path))
      .filter((n): n is Note => n !== undefined && canFavorite(n) && !isFavorite(n))
    // The stored list goes only once every favorite in it is a tag, so a failed write is retried
    // the next time the folder opens.
    void (async () => {
      let failed = false
      for (const note of pending) {
        try {
          await saveNote(note.path, withFavorite(note, true))
        } catch {
          failed = true
        }
      }
      if (failed) onError("Some favorites saved in this browser couldn't be moved into their notes' tags yet.")
      else forgetLegacyFavorites(workspaceId)
    })()
  }, [workspaceId, notes, saveNote, onError])

  return { favorites, toggle }
}
