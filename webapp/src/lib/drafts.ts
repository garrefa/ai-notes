// Unsaved edits (a body being edited, a title being renamed) kept in this browser's localStorage
// while they're in progress, so closing the tab mid-edit doesn't lose them: the next time that note
// opens, the viewer offers to restore the draft. Cleared as soon as the edit is saved or discarded.

export interface NoteDraft {
  // null = that part isn't being edited.
  body: string | null
  title: string | null
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
    const body = typeof doc.body === "string" ? doc.body : null
    const title = typeof doc.title === "string" ? doc.title : null
    if (body === null && title === null) return null
    return { body, title, savedAt: typeof doc.savedAt === "number" ? doc.savedAt : Date.now() }
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

// Storage failures are ignored: the in-page "unsaved changes" guard still protects the edit.
export function storeDraft(key: string | null, draft: Omit<NoteDraft, "savedAt"> | null): void {
  if (!key) return
  try {
    if (!draft || (draft.body === null && draft.title === null)) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }))
  } catch {
    // Not persisted.
  }
}

export function forgetDraft(key: string | null): void {
  storeDraft(key, null)
}
