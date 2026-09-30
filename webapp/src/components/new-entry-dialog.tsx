import { useId, useState, type FormEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useAsyncAction } from "@/hooks/use-async-action"
import { buildNewEntry, ENTRY_KINDS, kindNeedsTag, kindNeedsTitle, parseTagInput, type EntryKind, type NewEntry } from "@/lib/new-entry"
import type { NewTaskRow } from "@/lib/notes-fs"
import { localIsoDate } from "@/lib/notes-frontmatter"
import type { TaskStatus } from "@/lib/task-status"
import { cn } from "@/lib/utils"

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultKind: EntryKind
  allTags: string[]
  // The status a new task starts in (the first one in the catalog).
  initialTaskStatus: TaskStatus
  onCreate: (entry: NewEntry, task: NewTaskRow | null) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <NewEntryForm
            defaultKind={defaultKind}
            allTags={allTags}
            initialTaskStatus={initialTaskStatus}
            onCreate={onCreate}
            onCancel={() => onOpenChange(false)}
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
  onCreate,
  onCancel,
}: {
  defaultKind: EntryKind
  allTags: string[]
  initialTaskStatus: TaskStatus
  onCreate: (entry: NewEntry, task: NewTaskRow | null) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const [kind, setKind] = useState<EntryKind>(defaultKind)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(() => localIsoDate())
  const [deadline, setDeadline] = useState("")
  const [tagText, setTagText] = useState("")
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
      { kind, title: cleanTitle, date, tags, deadline: deadline || null, status: initialTaskStatus },
      localIsoDate(),
    )
    const task: NewTaskRow | null =
      kind === "task" ? { title: cleanTitle, created: date, deadline: deadline || null, status: initialTaskStatus } : null
    await create.run(() => onCreate(entry, task))
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New {kindLabel.toLowerCase()}</DialogTitle>
        <DialogDescription>
          Written to the open folder in the same format the ainotes skills use, and added to INDEX.md
          {kind === "task" ? " and TASKS.md" : ""}. Commit it to git as usual.
        </DialogDescription>
      </DialogHeader>

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

      {(validation || create.error) && <p className="text-sm text-destructive">{validation ?? create.error}</p>}

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
