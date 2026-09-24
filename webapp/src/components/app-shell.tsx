import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, FolderOpen, ListChecks, ListTodo, NotebookText, Radio, RefreshCw, Search, StickyNote } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { CommandPalette } from "@/components/command-palette"
import { NoteDetail } from "@/components/note-detail"
import { PendingPrs } from "@/components/pending-prs"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useNotesDirectory } from "@/hooks/use-notes-directory"
import { displayStatus, displayTag, formatDateHeading, groupNotesByDate, uniqueTags, type Note, type NoteSource } from "@/lib/notes-frontmatter"

const JIRA_TICKET_RE = /^[A-Za-z]{3}-\d{4}$/

type View = "all" | "notes" | "plans" | "daily" | "tasks"

function tagCounts(notes: Note[]) {
  const counts = new Map<string, number>()
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([tag]) => !JIRA_TICKET_RE.test(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function viewMatchesSource(view: View, source: NoteSource) {
  if (view === "notes") return source === "notes"
  if (view === "plans") return source === "plans"
  if (view === "daily") return source === "daily"
  if (view === "tasks") return source === "tasks"
  return true
}

export function AppShell() {
  const { status, directoryName, notes, prs, error, busy, connect, reconnect, saveNote } = useNotesDirectory()

  const [view, setView] = useState<View>("all")
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagQuery, setTagQuery] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const counts = useMemo(() => tagCounts(notes), [notes])
  const allTags = useMemo(() => uniqueTags(notes), [notes])
  const dateRangeActive = Boolean(dateFrom || dateTo)

  const filtered = useMemo(() => {
    // The note currently open never gets filtered out of its own list — editing a note's
    // tags to no longer match the active tag filter shouldn't make it vanish mid-edit.
    let list = notes.filter((n) => viewMatchesSource(view, n.source) || n.path === selectedPath)
    if (activeTag) list = list.filter((n) => n.tags.includes(activeTag) || n.path === selectedPath)
    if (dateFrom || dateTo) {
      list = list.filter(
        (n) => (n.date && (!dateFrom || n.date >= dateFrom) && (!dateTo || n.date <= dateTo)) || n.path === selectedPath,
      )
    }
    return list
  }, [notes, view, activeTag, dateFrom, dateTo, selectedPath])

  const selected = notes.find((n) => n.path === selectedPath) ?? filtered[0] ?? null
  const connected = status === "connected"

  // Nothing is explicitly selected yet (selectedPath is still null) but a note is showing
  // via the filtered[0] fallback — pin it as the real selection so the "keep the open note
  // visible" exemptions above actually apply to it, instead of only kicking in once you've
  // clicked a note card yourself.
  useEffect(() => {
    if (!selectedPath && filtered[0]) setSelectedPath(filtered[0].path)
  }, [selectedPath, filtered])

  // The active tag filter no longer matches anything anywhere (its last note just had it
  // removed) — drop the filter rather than leave it silently pinned to a tag that no longer
  // exists. This never touches selectedPath, so whatever note is open stays open.
  useEffect(() => {
    if (activeTag && !notes.some((n) => n.tags.includes(activeTag))) {
      setActiveTag(null)
    }
  }, [activeTag, notes])

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="flex-row items-center gap-2 px-3 py-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <NotebookText className="size-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">AINotes</span>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Library</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "all"} onClick={() => setView("all")}>
                    <StickyNote />
                    All notes
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "notes"} onClick={() => setView("notes")}>
                    <NotebookText />
                    Notes
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "plans"} onClick={() => setView("plans")}>
                    <ListTodo />
                    Plans
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "daily"} onClick={() => setView("daily")}>
                    <CalendarDays />
                    Daily
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "tasks"} onClick={() => setView("tasks")}>
                    <ListChecks />
                    Tasks
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between">
              Date range
              {dateRangeActive && (
                <button
                  onClick={() => {
                    setDateFrom("")
                    setDateTo("")
                  }}
                  className="font-normal text-primary normal-case"
                >
                  Clear
                </button>
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent className="grid grid-cols-2 gap-2 px-2">
              <label className="space-y-1">
                <span className="block text-[10px] text-muted-foreground">From</span>
                <Input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-7 px-2 text-xs"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] text-muted-foreground">To</span>
                <Input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-7 px-2 text-xs"
                />
              </label>
            </SidebarGroupContent>
          </SidebarGroup>

          {connected && prs && prs.length > 0 && (
            <SidebarGroup>
              <SidebarGroupContent className="px-2">
                <PendingPrs prs={prs} />
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          <SidebarGroup>
            <SidebarGroupLabel>Tags</SidebarGroupLabel>
            <SidebarGroupContent className="space-y-2 px-2">
              <Input
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                placeholder="Search tags"
                className="h-7 text-xs"
              />
              <div className="flex flex-wrap gap-1.5">
                {counts
                  .filter(([tag]) => tag.toLowerCase().includes(tagQuery.trim().toLowerCase()))
                  .map(([tag, n]) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                        activeTag === tag
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {displayTag(tag)} <span className="opacity-60">{n}</span>
                    </button>
                  ))}
                {connected && counts.length === 0 && (
                  <p className="px-0.5 text-xs text-muted-foreground">No tags yet.</p>
                )}
              </div>
              <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
                Jira ticket tags hidden from the cloud — search by number instead.
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-2">
          {status === "unsupported" ? (
            <div className="flex items-start gap-2 rounded-lg bg-muted p-2 text-[11px] leading-snug text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Needs Chrome 133+ for the File System Access API and FileSystemObserver.
            </div>
          ) : status === "needs-permission" ? (
            <Button variant="outline" size="sm" className="justify-start gap-2" onClick={reconnect} disabled={busy}>
              <RefreshCw className="size-3.5" />
              Reconnect {directoryName ? `"${directoryName}"` : "folder"}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="justify-start gap-2" onClick={connect} disabled={busy}>
              <FolderOpen className="size-3.5" />
              {connected ? "Change folder" : "Connect folder"}
            </Button>
          )}

          {status !== "unsupported" && (
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              <Radio
                className={`size-3 ${connected ? "animate-pulse text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              />
              {busy
                ? "Connecting…"
                : connected
                  ? `Watching · ${directoryName}`
                  : status === "needs-permission"
                    ? "Permission needed"
                    : status === "error"
                      ? (error ?? "Something went wrong")
                      : "Not connected"}
            </div>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <SidebarTrigger />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            disabled={!connected}
            className="ml-auto gap-2 text-muted-foreground"
          >
            <Search className="size-3.5" />
            Search notes…
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
          </Button>
          <ThemeSwitcher />
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="h-full w-full max-w-md shrink-0 overflow-y-auto border-r border-border">
            <div className="space-y-4 p-3">
              {!connected && (
                <div className="p-4 text-sm text-muted-foreground">
                  {status === "needs-permission"
                    ? "Reconnect your folder to keep browsing your notes."
                    : "Connect a folder to browse your notes, plans, and daily logs."}
                </div>
              )}
              {connected && filtered.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No notes in this view yet.</p>
              )}
              {groupNotesByDate(filtered).map((group) => (
                <div key={group.date ?? "no-date"}>
                  <div className="mb-2 flex items-baseline justify-between px-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span>{formatDateHeading(group.date)}</span>
                    <span className="normal-case text-muted-foreground/70">
                      {group.notes.length} {group.notes.length === 1 ? "note" : "notes"}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.notes.map((note) => (
                      <button
                        key={note.path}
                        onClick={() => setSelectedPath(note.path)}
                        className={`block w-full rounded-lg border p-3 text-left transition-colors ${
                          note.path === selected?.path
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="mb-1 text-sm font-semibold">{note.title}</div>
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          {note.type && (
                            <Badge variant="secondary" className="text-[10px]">
                              {note.type}
                            </Badge>
                          )}
                          {displayStatus(note.status) && (
                            <span className="text-[11px] text-muted-foreground">{displayStatus(note.status)}</span>
                          )}
                        </div>
                        {note.excerpt && <p className="mb-1.5 line-clamp-2 text-xs text-muted-foreground">{note.excerpt}</p>}
                        <div className="flex flex-wrap gap-1">
                          {note.tags.map((t) => (
                            <span key={t} className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                              {displayTag(t)}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="h-full min-w-0 flex-1 overflow-y-auto">
            {selected ? (
              <NoteDetail key={selected.path} note={selected} onSave={saveNote} allTags={allTags} />
            ) : (
              <div className="mx-auto flex h-full max-w-2xl items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {connected ? "Select a note to read it." : "Nothing to show yet."}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>

      <CommandPalette notes={notes} open={paletteOpen} onOpenChange={setPaletteOpen} onSelectNote={setSelectedPath} />
    </SidebarProvider>
  )
}
