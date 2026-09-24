import { useId, useState } from "react"
import { ChevronDown, Pencil, Plus, X } from "lucide-react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { TaskStatusDot } from "@/components/task-status-dot"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { displayTag, withUpdatedTags, type Note } from "@/lib/notes-frontmatter"
import type { ResolvedTaskStatus } from "@/lib/task-status"
import type { TaskStatus } from "@/lib/workspace-config"

// Status picker for a task file. Writing goes through onChange, which updates the task file and
// TASKS.md; a problem with the ledger comes back as a non-blocking notice.
function TaskStatusControl({
  status,
  statuses,
  onChange,
}: {
  status: ResolvedTaskStatus
  statuses: TaskStatus[]
  onChange: (key: string) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function select(key: string) {
    if (key === status.key && status.known) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      setNotice(await onChange(key))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the status — check the folder is still connected.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 space-y-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={busy}>
          <Button size="sm" variant="outline" className="gap-2" aria-label={`Status: ${status.label}. Change status`}>
            <TaskStatusDot status={status} />
            {busy ? "Saving…" : status.label}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuRadioGroup value={status.known ? status.key : ""} onValueChange={select}>
            {statuses.map((s) => (
              <DropdownMenuRadioItem key={s.key} value={s.key} className="gap-2">
                <TaskStatusDot status={s} />
                {s.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function NoteDetail({
  note,
  onSave,
  allTags,
  taskStatus,
  taskStatuses,
  onSetTaskStatus,
}: {
  note: Note
  onSave: (path: string, content: string) => Promise<void>
  allTags: string[]
  // Set only for task files.
  taskStatus: ResolvedTaskStatus | null
  taskStatuses: TaskStatus[]
  onSetTaskStatus: (path: string, statusKey: string) => Promise<string | null>
}) {
  const tagListId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState("")
  const [tagBusy, setTagBusy] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)

  function startEditing() {
    setDraft(note.body)
    setSaveError(null)
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(note.path, note.rawFrontmatter + draft)
      setEditing(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save — check the folder is still connected.")
    } finally {
      setSaving(false)
    }
  }

  async function commitTags(nextTags: string[]) {
    setTagBusy(true)
    setTagError(null)
    try {
      await onSave(note.path, withUpdatedTags(note.rawFrontmatter, nextTags) + note.body)
    } catch (e) {
      setTagError(e instanceof Error ? e.message : "Couldn't update tags — check the folder is still connected.")
    } finally {
      setTagBusy(false)
    }
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

  return (
    <article className="mx-auto max-w-2xl p-6 lg:p-10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {note.tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full border border-border py-px pr-1 pl-1.5 font-mono text-[11px] text-muted-foreground"
            >
              {displayTag(t)}
              <button
                onClick={() => removeTag(t)}
                disabled={tagBusy}
                aria-label={`Remove tag ${displayTag(t)}`}
                className="text-muted-foreground/60 hover:text-destructive disabled:opacity-50"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          {addingTag ? (
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
              disabled={tagBusy}
              className="flex items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 py-px font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              <Plus className="size-2.5" />
              Tag
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setEditing(false)
                setSaveError(null)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={startEditing}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </div>

      {tagError && <p className="mb-2 text-xs text-destructive">{tagError}</p>}

      <h1 className="mb-1.5 text-lg font-semibold tracking-tight">{note.title}</h1>
      <div className="mb-4 font-mono text-xs text-muted-foreground">
        {[note.date, note.type, note.repo].filter(Boolean).join(" · ")}
      </div>

      {taskStatus && !editing && (
        <TaskStatusControl status={taskStatus} statuses={taskStatuses} onChange={(key) => onSetTaskStatus(note.path, key)} />
      )}

      {saveError && <p className="mb-4 text-sm text-destructive">{saveError}</p>}

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[50vh] w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-pre:overflow-x-auto">
          <Markdown remarkPlugins={[remarkGfm]}>{note.body}</Markdown>
        </div>
      )}
    </article>
  )
}
