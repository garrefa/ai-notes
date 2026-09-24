import { useEffect } from "react"
import { FileText, ListChecks, ListTodo } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { displayTag, type Note } from "@/lib/notes-frontmatter"

// cmdk's default filter runs a fuzzy-match scoring algorithm over `value` + every
// `keywords` entry on every keystroke, for every item. That's fine for short strings
// (tag names) but not for a full note body — with enough notes (and some genuinely long
// ones), that scoring pass froze the whole tab for tens of seconds per keystroke. A plain
// case-insensitive substring check is effectively instant regardless of body length, and
// for searching prose, "contains this text" is arguably the more predictable behavior
// anyway (results keep their original, date-sorted order rather than being re-ranked by
// fuzzy score).
function containsFilter(value: string, search: string, keywords?: string[]): number {
  if (!search) return 1
  const q = search.toLowerCase()
  if (value.toLowerCase().includes(q)) return 1
  return keywords?.some((k) => k.toLowerCase().includes(q)) ? 1 : 0
}

export function CommandPalette({
  notes,
  open,
  onOpenChange,
  onSelectNote,
}: {
  notes: Note[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectNote: (path: string) => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search notes"
      description="Jump to a note or plan"
      filter={containsFilter}
      className="top-[15%] translate-y-0 sm:max-w-2xl"
    >
      <CommandInput placeholder="Search titles and note content…" />
      <CommandList className="max-h-[65vh]">
        <CommandEmpty>No notes found.</CommandEmpty>
        <CommandGroup heading="Notes & plans">
          {notes.map((note) => {
            const Icon = note.source === "plans" ? ListTodo : note.source === "tasks" ? ListChecks : FileText
            return (
              <CommandItem
                key={note.path}
                value={note.title}
                keywords={[...note.tags, note.body]}
                onSelect={() => {
                  onSelectNote(note.path)
                  onOpenChange(false)
                }}
                className="items-start gap-3 py-2.5"
              >
                <Icon className="mt-0.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{note.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{note.date}</span>
                  </div>
                  {note.excerpt && <p className="line-clamp-1 text-xs text-muted-foreground">{note.excerpt}</p>}
                  {note.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {note.tags.slice(0, 5).map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                        >
                          {displayTag(t)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
