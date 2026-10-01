import { useEffect, useId, useImperativeHandle, useState, type Ref } from "react"
import { ChevronDown, History, Maximize2, Minimize2, Pencil, Plus, Trash2, X } from "lucide-react"

import { AddTaskButton } from "@/components/add-task-button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { CopyPath } from "@/components/copy-path"
import { FavoriteButton } from "@/components/favorite-heart"
import { MarkdownBody } from "@/components/markdown-body"
import { TaskStatusDot } from "@/components/task-status-dot"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAsyncAction } from "@/hooks/use-async-action"
import { forgetDraft, loadDraft, storeDraft, type NoteDraft } from "@/lib/drafts"
import { displayTag, withUpdatedTags, type Note } from "@/lib/notes-frontmatter"
import { isTaskFile, type TaskStatus } from "@/lib/task-status"

const DISCONNECTED_HINT = "check the folder is still connected."

// What the app shell needs to resolve "you have unsaved changes" before navigating away.
export interface NoteEditorHandle {
  // Whether leaving now would lose an edit (read at click time, so it's never a render behind).
  isDirty: () => boolean
  // Saves every pending edit; resolves to false (with the error shown) if that failed.
  save: () => Promise<boolean>
  discard: () => void
}

// Status picker for a task file. Writing goes through onChange, which updates the task file and
// TASKS.md; a problem with the ledger comes back as a non-blocking notice.
function TaskStatusControl({
  status,
  statuses,
  onChange,
}: {
  status: TaskStatus
  statuses: TaskStatus[]
  onChange: (key: string) => Promise<string | null>
}) {
  const action = useAsyncAction(`Couldn't update the status — ${DISCONNECTED_HINT}`)

  function select(key: string) {
    if (key !== status.key) void action.run(() => onChange(key))
  }

  return (
    <div className="space-y-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={action.busy}>
          <Button size="sm" variant="outline" className="gap-2" aria-label={`Status: ${status.label}. Change status`}>
            <TaskStatusDot status={status} />
            {action.busy ? "Saving…" : status.label}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuRadioGroup value={status.key} onValueChange={select}>
            {statuses.map((s) => (
              <DropdownMenuRadioItem key={s.key} value={s.key} className="gap-2">
                <TaskStatusDot status={s} />
                {s.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {action.notice && <p className="text-xs text-muted-foreground">{action.notice}</p>}
      {action.error && <p className="text-xs text-destructive">{action.error}</p>}
    </div>
  )
}

function formatDraftTime(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

// Toggles the note between the normal layout and filling the window.
function MaximizeButton({ maximized, onToggle }: { maximized: boolean; onToggle: () => void }) {
  const label = maximized ? "Restore layout (Esc)" : "Maximize"
  return (
    <Button size="icon-sm" variant="outline" aria-pressed={maximized} aria-label={label} title={label} onClick={onToggle}>
      {maximized ? <Minimize2 className="text-muted-foreground" /> : <Maximize2 className="text-muted-foreground" />}
    </Button>
  )
}

// A draft left over from a tab that was closed mid-edit.
function DraftRestoreBanner({ draft, onRestore, onDiscard }: { draft: NoteDraft; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-xs text-muted-foreground">
      <History className="size-3.5 shrink-0 text-primary" />
      <span className="flex-1">
        <span className="font-medium text-foreground">Unsaved changes found.</span> You left this note with edits
        that weren't saved ({formatDraftTime(draft.savedAt)}).
      </span>
      <Button size="xs" variant="ghost" onClick={onDiscard}>
        Discard
      </Button>
      <Button size="xs" onClick={onRestore}>
        Restore
      </Button>
    </div>
  )
}

export function NoteDetail({
  note,
  displayPath,
  onSave,
  onSaveBody,
  onUpdateDeadline,
  onDelete,
  allTags,
  taskStatus,
  taskStatuses,
  onSetTaskStatus,
  favorite,
  onToggleFavorite,
  draftKey,
  startEditing = false,
  editorRef,
  flatLayout = false,
  maximized,
  onToggleMaximize,
  onAddTask,
}: {
  note: Note
  // The note's path, starting with the connected folder's name (shown with a copy button).
  displayPath: string
  // Writes the whole file (used for tag edits).
  onSave: (path: string, content: string) => Promise<void>
  // Writes the body, keeping whatever frontmatter is on disk.
  onSaveBody: (path: string, body: string) => Promise<void>
  // Sets (or, with null, clears) a task's deadline; may return a non-blocking notice.
  onUpdateDeadline: (path: string, deadline: string | null) => Promise<string | null>
  // null when this file can't be deleted (the TASKS.md ledger).
  onDelete: ((path: string) => Promise<void>) | null
  allTags: string[]
  // Set only for task files.
  taskStatus: TaskStatus | null
  taskStatuses: TaskStatus[]
  onSetTaskStatus: (path: string, statusKey: string) => Promise<string | null>
  favorite: boolean
  // Adds or removes the `fav` tag; null when the file has no frontmatter to hold it.
  onToggleFavorite: (() => void) | null
  // Where unsaved edits are kept in case the tab closes (null: not kept, e.g. in the demo).
  draftKey: string | null
  // Opens straight into the body editor (a note that was just created).
  startEditing?: boolean
  editorRef?: Ref<NoteEditorHandle>
  // The workspace has no notes/plans/db convention to hang tags off of — the tag editor's
  // "add" affordance is hidden (existing tags, if any, can still be removed), and the
  // date/type/repo line is left out.
  flatLayout?: boolean
  // The note fills the content area (no sidebar or note list); drives the maximize button's state.
  maximized: boolean
  onToggleMaximize: () => void
  // Starts a task referencing this note; null where tasks can't be created (a flat folder).
  // Never offered on a task itself.
  onAddTask: (() => void) | null
}) {
  const tagListId = useId()
  const isTask = isTaskFile(note)

  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState(() => (startEditing ? note.body : ""))
  const [deadlineDraft, setDeadlineDraft] = useState(note.deadline ?? "")
  const [pendingDraft, setPendingDraft] = useState<NoteDraft | null>(() => {
    const stored = loadDraft(draftKey)
    const differs = stored !== null && stored.body !== note.body
    if (stored && !differs) forgetDraft(draftKey)
    return differs ? stored : null
  })
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const save = useAsyncAction(`Couldn't save — ${DISCONNECTED_HINT}`)
  const tagsAction = useAsyncAction(`Couldn't update tags — ${DISCONNECTED_HINT}`)
  const deleteAction = useAsyncAction(`Couldn't delete — ${DISCONNECTED_HINT}`)

  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState("")

  // The deadline value a save is writing right now: not "unsaved" while it's on its way to disk.
  const [savingDeadline, setSavingDeadline] = useState<string | null>(null)

  const bodyDirty = editing && draft !== note.body
  const deadlineDirty = isTask && deadlineDraft !== (note.deadline ?? "") && deadlineDraft !== savingDeadline
  const dirty = bodyDirty || deadlineDirty

  // Follow the deadline on disk (a save, another tab, the skills) unless it's mid-edit here.
  const [seenDeadline, setSeenDeadline] = useState(note.deadline)
  if (seenDeadline !== note.deadline) {
    setSeenDeadline(note.deadline)
    if (deadlineDraft === (seenDeadline ?? "")) setDeadlineDraft(note.deadline ?? "")
  }

  // The browser's own "Leave site?" prompt when the tab is closed or reloaded with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // Keep the in-progress edit in storage, so closing the tab anyway can still be undone. Left alone
  // while an older draft is waiting for Restore/Discard.
  useEffect(() => {
    if (pendingDraft) return
    storeDraft(draftKey, bodyDirty ? draft : null)
  }, [pendingDraft, draftKey, bodyDirty, draft])

  function startEditingBody() {
    setDraft(note.body)
    save.reset()
    setEditing(true)
  }

  function discardAll() {
    setEditing(false)
    setDeadlineDraft(note.deadline ?? "")
    save.reset()
    forgetDraft(draftKey)
  }

  function restoreDraft() {
    if (!pendingDraft) return
    setDraft(pendingDraft.body)
    setEditing(true)
    setPendingDraft(null)
  }

  function dismissDraft() {
    forgetDraft(draftKey)
    setPendingDraft(null)
  }

  // Body first: a deadline save also logs a line under the task's "## Updates" on disk, which a
  // later body save from the editor would overwrite.
  async function saveAll(): Promise<boolean> {
    return save.run(async () => {
      if (bodyDirty) await onSaveBody(note.path, draft)
      const notice = deadlineDirty ? await onUpdateDeadline(note.path, deadlineDraft || null) : null
      setEditing(false)
      forgetDraft(draftKey)
      return notice
    })
  }

  async function saveDeadline(value: string) {
    setDeadlineDraft(value)
    if (save.busy || value === (note.deadline ?? "")) return
    setSavingDeadline(value)
    try {
      await save.run(() => onUpdateDeadline(note.path, value || null))
    } finally {
      setSavingDeadline(null)
    }
  }

  useImperativeHandle(editorRef, () => ({ isDirty: () => dirty, save: saveAll, discard: discardAll }))

  function commitTags(nextTags: string[]) {
    void tagsAction.run(() => onSave(note.path, withUpdatedTags(note.rawFrontmatter, nextTags) + note.body))
  }

  function removeTag(tag: string) {
    commitTags(note.tags.filter((t) => t !== tag))
  }

  function addTag() {
    const value = tagInput.trim().replace(/[,[\]]/g, "")
    setTagInput("")
    setAddingTag(false)
    if (!value || note.tags.includes(value)) return
    commitTags([...note.tags, value])
  }

  async function confirmDelete() {
    if (!onDelete) return
    const ok = await deleteAction.run(() => onDelete(note.path))
    if (ok) {
      forgetDraft(draftKey)
      setConfirmingDelete(false)
    }
  }

  return (
    <article className="p-6 lg:p-10">
      {pendingDraft && <DraftRestoreBanner draft={pendingDraft} onRestore={restoreDraft} onDiscard={dismissDraft} />}

      {/* Date and type on the left, the note's actions on the right; tags go on the line below. The
          row stays pinned to the top of the detail pane as the note scrolls, so Maximize and Edit are
          always in reach; it spans the article's padding so the note scrolls under a solid band. */}
      <div className="sticky top-0 z-10 -mx-6 -mt-2 mb-1 flex items-center gap-1.5 bg-background/95 px-6 py-2 backdrop-blur-sm lg:-mx-10 lg:px-10">
        <div className="mr-auto min-w-0 truncate font-mono text-xs text-muted-foreground">
          {!flatLayout && [note.date, note.type, note.repo].filter(Boolean).join(" · ")}
        </div>
        {onAddTask && !isTask && !editing && <AddTaskButton onClick={onAddTask} />}
        {onToggleFavorite && <FavoriteButton favorite={favorite} onToggle={onToggleFavorite} />}
        {onDelete && !editing && (
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Delete"
            title="Delete"
            onClick={() => {
              deleteAction.reset()
              setConfirmingDelete(true)
            }}
          >
            <Trash2 className="text-muted-foreground" />
          </Button>
        )}
        {editing ? (
          <>
            <Button size="sm" variant="ghost" disabled={save.busy} onClick={discardAll}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.busy} onClick={saveAll}>
              {save.busy ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={startEditingBody}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
        <MaximizeButton maximized={maximized} onToggle={onToggleMaximize} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {note.tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full border border-border py-px pr-1 pl-1.5 font-mono text-[11px] text-muted-foreground"
            >
              {displayTag(t)}
              <button
                onClick={() => removeTag(t)}
                disabled={tagsAction.busy}
                aria-label={`Remove tag ${displayTag(t)}`}
                className="text-muted-foreground/60 hover:text-destructive disabled:opacity-50"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          {!flatLayout &&
            (addingTag ? (
              <>
                <input
                  autoFocus
                  list={tagListId}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTag()
                    if (e.key === "Escape") {
                      setAddingTag(false)
                      setTagInput("")
                    }
                  }}
                  onBlur={addTag}
                  placeholder="tag name"
                  className="w-32 rounded-full border border-border bg-background px-2 py-px font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <datalist id={tagListId}>
                  {allTags
                    .filter((t) => !note.tags.includes(t))
                    .map((t) => (
                      <option key={t} value={t} />
                    ))}
                </datalist>
              </>
            ) : (
              <button
                onClick={() => setAddingTag(true)}
                disabled={tagsAction.busy}
                className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 py-px font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <Plus className="size-2.5" />
                Tag
              </button>
            ))}
      </div>

      {tagsAction.error && <p className="mb-2 text-xs text-destructive">{tagsAction.error}</p>}

      {/* A title that is the body's "# heading" already shows at the top of the rendered body. */}
      {!note.titleFromHeading && <h1 className="mb-1.5 text-lg font-semibold tracking-tight">{note.title}</h1>}
      <div className="mb-4">
        <CopyPath path={displayPath} />
      </div>

      {taskStatus && (
        <div className="mb-4 flex flex-wrap items-start gap-3">
          {!editing && (
            <TaskStatusControl status={taskStatus} statuses={taskStatuses} onChange={(key) => onSetTaskStatus(note.path, key)} />
          )}
          {isTask && (
            <label className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
              Deadline
              <input
                type="date"
                value={deadlineDraft}
                onChange={(e) => setDeadlineDraft(e.target.value)}
                // A half-typed date reads as "" (badInput): leaving the field then keeps the saved deadline.
                // Reads the field itself, not the draft state, which may not have re-rendered yet.
                onBlur={(e) =>
                  e.currentTarget.validity.badInput ? setDeadlineDraft(note.deadline ?? "") : saveDeadline(e.currentTarget.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.currentTarget.validity.badInput) void saveDeadline(e.currentTarget.value)
                }}
                disabled={save.busy || editing}
                title={editing ? "Save or cancel the body edit first" : undefined}
                className="h-7 rounded-md border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {deadlineDraft && !editing && (
                <button
                  type="button"
                  onClick={() => saveDeadline("")}
                  disabled={save.busy}
                  aria-label="Clear deadline"
                  title="Clear deadline"
                  className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </label>
          )}
        </div>
      )}

      {save.notice && <p className="mb-4 text-xs text-muted-foreground">{save.notice}</p>}
      {save.error && <p className="mb-4 text-sm text-destructive">{save.error}</p>}

      {editing ? (
        <textarea
          autoFocus={startEditing}
          readOnly={save.busy}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[50vh] w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <MarkdownBody notePath={note.path}>{note.body}</MarkdownBody>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete "${note.title}"?`}
        description={
          <>
            This deletes <code className="font-mono">{displayPath}</code> and removes it from INDEX.md
            {isTask ? " and its row from TASKS.md" : ""}. The viewer can't undo this; if the notes repo is a git repo,
            the file can be restored from git.
          </>
        }
        busy={deleteAction.busy}
        error={deleteAction.error}
        actions={[
          { label: "Cancel", variant: "outline", onClick: () => setConfirmingDelete(false) },
          { label: deleteAction.busy ? "Deleting…" : "Delete", variant: "destructive", onClick: confirmDelete },
        ]}
      />
    </article>
  )
}
