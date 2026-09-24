import { useEffect } from "react"
import { FileText, FolderOpen, FolderPlus, GitPullRequest, ListChecks, ListTodo, Settings } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { TaskStatusDot } from "@/components/task-status-dot"
import type { WorkspaceSummary } from "@/hooks/use-notes-directory"
import type { TaskStatus } from "@/lib/task-status"
import { displayTag, type Note } from "@/lib/notes-frontmatter"
import { PR_STATES, prTitle } from "@/lib/pr-view"
import type { LedgerPr } from "@/lib/prs-parser"

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
  taskStatusByPath,
  workspaces,
  activeWorkspaceId,
  open,
  onOpenChange,
  onSelectNote,
  onSwitchWorkspace,
  onAddWorkspace,
  onOpenSettings,
  prs,
  onSelectPr,
}: {
  notes: Note[]
  taskStatusByPath: Map<string, TaskStatus>
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectNote: (path: string) => void
  onSwitchWorkspace: (id: string) => void
  onAddWorkspace: () => void
  onOpenSettings: () => void
  // Every PR in PRS.md (pending, merged, closed).
  prs: LedgerPr[]
  onSelectPr: (pr: LedgerPr) => void
}) {
  const otherWorkspaces = workspaces.filter((ws) => ws.id !== activeWorkspaceId)

  // Selecting runs inside the click/keypress handler, so the permission prompt (for a
  // folder whose access lapsed) or folder picker still counts as user-initiated.
  function runAndClose(action: () => void) {
    action()
    onOpenChange(false)
  }

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
      description="Jump to a note, plan or pull request, switch notes folder, or open settings"
      filter={containsFilter}
      className="top-[15%] translate-y-0 sm:max-w-2xl"
    >
      <CommandInput placeholder="Search titles and note content…" />
      <CommandList className="max-h-[65vh]">
        <CommandEmpty>No notes found.</CommandEmpty>
        <CommandGroup heading="Notes folders">
          {otherWorkspaces.map((ws) => (
            <CommandItem
              key={ws.id}
              value={`workspace:${ws.id}`}
              keywords={[`Switch to ${ws.label}`, "folder", "workspace"]}
              onSelect={() => runAndClose(() => onSwitchWorkspace(ws.id))}
            >
              <FolderOpen />
              Switch to {ws.label}
            </CommandItem>
          ))}
          <CommandItem value="workspace:add" keywords={["Add folder", "workspace", "connect"]} onSelect={() => runAndClose(onAddWorkspace)}>
            <FolderPlus />
            Add folder…
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="App">
          <CommandItem value="app:settings" keywords={["Settings", "preferences", "status", "colors"]} onSelect={() => runAndClose(onOpenSettings)}>
            <Settings />
            Settings
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Notes & plans">
          {notes.map((note) => {
            const Icon = note.source === "plans" ? ListTodo : note.source === "tasks" ? ListChecks : FileText
            const taskStatus = taskStatusByPath.get(note.path)
            return (
              <CommandItem
                key={note.path}
                value={note.title}
                keywords={[...note.tags, note.body]}
                onSelect={() => runAndClose(() => onSelectNote(note.path))}
                className="items-start gap-3 py-2.5"
              >
                <Icon className="mt-0.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {taskStatus && <TaskStatusDot status={taskStatus} />}
                      <span className="truncate font-medium">{note.title}</span>
                    </span>
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
        {prs.length > 0 && (
          <CommandGroup heading="Pull requests">
            {prs.map((pr) => {
              const stateLabel = PR_STATES.find((s) => s.state === pr.state)?.label ?? pr.state
              return (
                <CommandItem
                  key={pr.key}
                  value={`${prTitle(pr)} ${pr.repo}#${pr.number}`}
                  keywords={[pr.repo, `#${pr.number}`, pr.jira ?? "", stateLabel, "pull request", "PR"]}
                  onSelect={() => runAndClose(() => onSelectPr(pr))}
                  className="items-start gap-3 py-2.5"
                >
                  <GitPullRequest className="mt-0.5" />
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="truncate font-medium">{prTitle(pr)}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {pr.repo}#{pr.number} · {stateLabel}
                    </span>
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
