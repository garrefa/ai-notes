import { useId, useState, type FormEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { buildNewEntry, ENTRY_KINDS, kindNeedsTag, kindNeedsTitle, parseTagInput, type EntryKind, type NewEntry } from "@/lib/new-entry"
import type { NewTaskRow } from "@/lib/notes-fs"
import { localIsoDate } from "@/lib/notes-frontmatter"
import { describeTaskOrigin, taskOriginPrs, taskOriginTags, type TaskOrigin } from "@/lib/task-origin"
import type { TaskStatus } from "@/lib/task-status"
import { cn } from "@/lib/utils"

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Where the content box's text goes in each kind of file, and what to suggest writing there.
const CONTENT_FIELD: Record<EntryKind, { label: string; placeholder: string }> = {
  note: { label: "Content (optional)", placeholder: "Markdown, written under the title." },
  plan: { label: "Content (optional)", placeholder: "## Goal\n\n## Steps\n- " },
  daily: { label: "Tasks (optional)", placeholder: "- [ ] First thing\n- [ ] Second thing" },
  task: { label: "Purpose (optional)", placeholder: "What this task is for, and what done looks like." },
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// Creates a note, plan, daily plan or task in the open folder, laid out the way the ainotes-*
// skills write them. The form is remounted each time the dialog opens, so it always starts fresh.
export function NewEntryDialog({
  open,
  onOpenChange,
  defaultKind,
  allTags,
  initialTaskStatus,
  origin,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultKind: EntryKind
  allTags: string[]
  // The status a new task starts in (the first one in the catalog).
  initialTaskStatus: TaskStatus
  // Set by "Add task": the form makes a task only, and the task references this item.
  origin: TaskOrigin | null
  onCreate: (entry: NewEntry, task: NewTaskRow | null) => Promise<void>
}) {
  // Content typed in the form: a stray click outside or Esc then leaves it alone (Cancel still discards).
  const [hasDraft, setHasDraft] = useState(false)
  const keepDraft = (e: Event) => {
    if (hasDraft) e.preventDefault()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setHasDraft(false)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onInteractOutside={keepDraft} onEscapeKeyDown={keepDraft}>
        {open && (
          <NewEntryForm
            defaultKind={defaultKind}
            allTags={allTags}
            initialTaskStatus={initialTaskStatus}
            origin={origin}
            onCreate={onCreate}
            onDraftChange={setHasDraft}
            onCancel={() => {
              setHasDraft(false)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewEntryForm({
  defaultKind,
  allTags,
  initialTaskStatus,
  origin,
  onCreate,
  onDraftChange,
  onCancel,
}: {
  defaultKind: EntryKind
  allTags: string[]
  initialTaskStatus: TaskStatus
  origin: TaskOrigin | null
  onCreate: (entry: NewEntry, task: NewTaskRow | null) => Promise<void>
  // Whether the content box holds text the user would lose by closing.
  onDraftChange: (hasDraft: boolean) => void
  onCancel: () => void
}) {
  const id = useId()
  const [kind, setKind] = useState<EntryKind>(origin ? "task" : defaultKind)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(() => localIsoDate())
  const [deadline, setDeadline] = useState("")
  const [tagText, setTagText] = useState(() => (origin ? taskOriginTags(origin).join(", ") : ""))
  // Kept across kind switches: what's typed is the user's, whatever kind it ends up in.
  const [body, setBody] = useState("")
  const [validation, setValidation] = useState<string | null>(null)
  const create = useAsyncAction("Couldn't create it — check the folder is still connected.")

  const tags = parseTagInput(tagText)
  const kindLabel = ENTRY_KINDS.find((k) => k.kind === kind)!.label

  function validate(): string | null {
    if (kindNeedsTitle(kind) && !title.trim()) return "Give it a title."
    if (!ISO_DATE_RE.test(date)) return "Pick a date."
    if (kindNeedsTag(kind) && tags.length === 0) return "Add at least one tag: it's how INDEX.md finds this later."
    return null
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    setValidation(problem)
    if (problem) return
    const cleanTitle = title.trim()
    const entry = buildNewEntry(
      { kind, title: cleanTitle, date, tags, deadline: deadline || null, status: initialTaskStatus, origin, body },
      localIsoDate(),
    )
    const task: NewTaskRow | null =
      kind === "task"
        ? {
            title: cleanTitle,
            created: date,
            deadline: deadline || null,
            status: initialTaskStatus,
            prs: origin ? taskOriginPrs(origin) : [],
          }
        : null
    await create.run(() => onCreate(entry, task))
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New {kindLabel.toLowerCase()}</DialogTitle>
        <DialogDescription>
          Written to the open folder in the same format the ainotes skills use, and added to INDEX.md
          {kind === "task" ? " and TASKS.md" : ""}. Commit it to git as usual.
          {origin && ` It will reference ${describeTaskOrigin(origin)}.`}
        </DialogDescription>
      </DialogHeader>

      {!origin && (
        <div role="radiogroup" aria-label="Kind" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {ENTRY_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              onClick={() => {
                setKind(k.kind)
                setValidation(null)
              }}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                kind === k.kind ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {kindNeedsTitle(kind) && (
        <Field label="Title" htmlFor={`${id}-title`}>
          <Input id={`${id}-title`} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${kindLabel} title`} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === "task" ? "Created" : "Date"} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="font-mono" />
        </Field>
        {kind === "task" && (
          <Field label="Deadline (optional)" htmlFor={`${id}-deadline`}>
            <Input id={`${id}-deadline`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="font-mono" />
          </Field>
        )}
      </div>

      <Field
        label={kindNeedsTag(kind) ? "Tags" : "Extra tags (optional)"}
        htmlFor={`${id}-tags`}
        hint={kind === "task" ? "Tagged task automatically." : kind === "daily" ? "Tagged daily-plan automatically." : "Comma-separated."}
      >
        <Input
          id={`${id}-tags`}
          list={`${id}-tag-options`}
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="e.g. payments, investigation"
          className="font-mono text-xs"
        />
        <datalist id={`${id}-tag-options`}>
          {allTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>

      <Field
        label={CONTENT_FIELD[kind].label}
        htmlFor={`${id}-body`}
        hint={body.trim() ? undefined : "Leave it empty to start from the usual template in the editor."}
      >
        <Textarea
          id={`${id}-body`}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            onDraftChange(e.target.value.trim() !== "")
          }}
          placeholder={CONTENT_FIELD[kind].placeholder}
          spellCheck={false}
          className="max-h-[40dvh] min-h-28 resize-y font-mono text-xs leading-relaxed"
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter creates from inside the box; plain Enter is a new line.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
        />
      </Field>

      {(validation || create.error) &&<p className="text-sm text-destructive">{validation ?? create.error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={create.busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.busy}>
          {create.busy ? "Creating…" : `Create ${kindLabel.toLowerCase()}`}
        </Button>
      </DialogFooter>
    </form>
  )
}
