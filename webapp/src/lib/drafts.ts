// An unsaved body edit, kept in this browser's localStorage while it's in progress, so closing the
// tab mid-edit doesn't lose it: the next time that note opens, the viewer offers to restore the
// draft. Cleared as soon as the edit is saved or discarded.

export interface NoteDraft {
  body: string
  savedAt: number
}

const DRAFT_KEY_PREFIX = "ainotes-draft:"

export function draftKey(workspaceId: string, notePath: string): string {
  return `${DRAFT_KEY_PREFIX}${workspaceId}:${notePath}`
}

function parseDraft(text: string | null): NoteDraft | null {
  if (!text) return null
  try {
    const doc = JSON.parse(text) as Partial<NoteDraft>
    if (typeof doc.body !== "string") return null
    return { body: doc.body, savedAt: typeof doc.savedAt === "number" ? doc.savedAt : Date.now() }
  } catch {
    return null
  }
}

export function loadDraft(key: string | null): NoteDraft | null {
  if (!key) return null
  try {
    return parseDraft(localStorage.getItem(key))
  } catch {
    return null
  }
}

// `body` null clears the draft. Storage failures are ignored: the in-page "unsaved changes" guard
// still protects the edit.
export function storeDraft(key: string | null, body: string | null): void {
  if (!key) return
  try {
    if (body === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ body, savedAt: Date.now() }))
  } catch {
    // Not persisted.
  }
}

export function forgetDraft(key: string | null): void {
  storeDraft(key, null)
}
