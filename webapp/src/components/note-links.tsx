import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, ExternalLink, Maximize2, Minimize2, X } from "lucide-react"

import { MarkdownBody } from "@/components/markdown-body"
import { NoteLinksContext, type NoteLinks } from "@/components/note-link"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { buildNoteLinkIndex } from "@/lib/note-links"
import type { Note } from "@/lib/notes-frontmatter"

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  )
}

// A referenced note, read-only, over the current one. Links inside it open the next note in the same
// popover (Back returns); Maximize fills the window; Open makes it the main note.
function NotePreviewDialog({
  note,
  canGoBack,
  onBack,
  onClose,
  onOpen,
  describePath,
}: {
  note: Note | null
  canGoBack: boolean
  onBack: () => void
  onClose: () => void
  onOpen: (path: string) => void
  describePath: (path: string) => string
}) {
  const [maximized, setMaximized] = useState(false)
  const maximizeLabel = maximized ? "Restore size" : "Maximize"

  return (
    <Dialog open={note !== null} onOpenChange={(open) => !open && onClose()}>
      {note && (
        <DialogContent
          showCloseButton={false}
          className={cn(
            "flex flex-col gap-0 overflow-hidden p-0",
            maximized ? "h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] sm:max-w-none" : "max-h-[80dvh] sm:max-w-2xl",
          )}
        >
          <div className="flex items-center gap-1 border-b border-border px-3 py-2">
            {canGoBack && (
              <ToolbarButton label="Back" onClick={onBack}>
                <ArrowLeft className="text-muted-foreground" />
              </ToolbarButton>
            )}
            <div className="mr-auto min-w-0 pl-1">
              <DialogTitle className="truncate text-sm font-semibold">{note.title}</DialogTitle>
              <DialogDescription className="truncate font-mono text-[11px]">{describePath(note.path)}</DialogDescription>
            </div>
            <ToolbarButton label="Open note" onClick={() => onOpen(note.path)}>
              <ExternalLink className="text-muted-foreground" />
            </ToolbarButton>
            <ToolbarButton label={maximizeLabel} onClick={() => setMaximized((m) => !m)}>
              {maximized ? <Minimize2 className="text-muted-foreground" /> : <Maximize2 className="text-muted-foreground" />}
            </ToolbarButton>
            <DialogClose asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Close" title="Close">
                <X className="text-muted-foreground" />
              </Button>
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <MarkdownBody notePath={note.path}>{note.body}</MarkdownBody>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

// Lets every rendered note open the notes it references, and hosts the one preview popover.
export function NoteLinksProvider({
  notes,
  onOpenNote,
  describePath,
  children,
}: {
  notes: Note[]
  // Shows the note as the main one (the popover closes first).
  onOpenNote: (path: string) => void
  describePath: (path: string) => string
  children: ReactNode
}) {
  // Paths, not notes: a preview follows the note's latest version on disk, and ends if it's deleted.
  const [trail, setTrail] = useState<string[]>([])
  const index = useMemo(() => buildNoteLinkIndex(notes), [notes])
  const links = useMemo<NoteLinks>(
    () => ({ index, preview: (note) => setTrail((t) => (t.at(-1) === note.path ? t : [...t, note.path])) }),
    [index],
  )
  const currentPath = trail.at(-1)
  const current = currentPath ? (notes.find((n) => n.path === currentPath) ?? null) : null

  return (
    <NoteLinksContext.Provider value={links}>
      {children}
      <NotePreviewDialog
        note={current}
        canGoBack={trail.length > 1}
        onBack={() => setTrail((t) => t.slice(0, -1))}
        onClose={() => setTrail([])}
        onOpen={(path) => {
          setTrail([])
          onOpenNote(path)
        }}
        describePath={describePath}
      />
    </NoteLinksContext.Provider>
  )
}
