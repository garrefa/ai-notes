import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, FlaskConical, FolderOpen, FolderSearch, GitPullRequest, KeyRound, ListChecks, ListTodo, NotebookText, Radio, RefreshCw, Search, Settings, StickyNote, Trash2, X } from "lucide-react"

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
import { PrDetail } from "@/components/pr-detail"
import { PrList } from "@/components/pr-list"
import { StatusSettingsDialog } from "@/components/status-settings-dialog"
import { TaskStatusDot } from "@/components/task-status-dot"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { useNotesDirectory, type NotesDirectory } from "@/hooks/use-notes-directory"
import { displayStatus, displayTag, formatDateHeading, groupNotesByDate, uniqueTags, type Note, type NoteSource } from "@/lib/notes-frontmatter"
import { countByState, filterPrs, reposIn, tasksByPrKey } from "@/lib/pr-view"
import type { PrState } from "@/lib/prs-parser"
import { useStatusSettings, type StatusSettings } from "@/lib/status-settings"
import {
  buildStatusCatalog,
  defaultStatusFilter,
  discoverStatusKeys,
  isTaskFile,
  resolveTaskStatus,
  type TaskStatus,
} from "@/lib/task-status"

const JIRA_TICKET_RE = /^[A-Za-z]{3}-\d{4}$/

type View = "all" | "notes" | "plans" | "daily" | "tasks" | "prs"

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
  if (view === "prs") return false
  return true
}

export function AppShell() {
  const directory = useNotesDirectory()
  // Outside the keyed view: status settings are global, not per folder.
  const statusSettings = useStatusSettings()

  return (
    <SidebarProvider>
      {/* Keyed by workspace: switching folders remounts everything below, so the selected
          note, view, filters, tag search and palette state never leak from one folder into
          another. The SidebarProvider stays outside so the sidebar's open/closed state does. */}
      <WorkspaceView key={directory.activeWorkspace?.id ?? "none"} directory={directory} statusSettings={statusSettings} />
    </SidebarProvider>
  )
}

function WorkspaceView({ directory, statusSettings }: { directory: NotesDirectory; statusSettings: StatusSettings }) {
  const {
    supported,
    status,
    workspaces,
    activeWorkspace,
    layout,
    notes,
    prLedger,
    error,
    notice,
    busy,
    addWorkspace,
    switchWorkspace,
    reopenActive,
    locateWorkspace,
    renameWorkspace,
    removeWorkspace,
    refreshAvailability,
    startDemo,
    exitDemo,
    dismissNotice,
    saveNote,
    updateTaskStatus,
  } = directory
  const folderName = activeWorkspace?.label ?? null
  const inDemo = activeWorkspace?.demo ?? false
  const addFolder = supported ? addWorkspace : null

  const [view, setView] = useState<View>("all")
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagQuery, setTagQuery] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // null = the default: every status that isn't closed.
  const [statusFilter, setStatusFilter] = useState<string[] | null>(null)
  const [prState, setPrState] = useState<PrState>("pending")
  const [prRepo, setPrRepo] = useState<string | null>(null)
  const [selectedPrKey, setSelectedPrKey] = useState<string | null>(null)

  // Built-in statuses plus every other value this folder's tasks use, with the user's settings applied.
  const statusCatalog = useMemo(
    () => buildStatusCatalog(discoverStatusKeys(notes), statusSettings.overrides),
    [notes, statusSettings.overrides],
  )
  const effectiveStatusFilter = useMemo(() => statusFilter ?? defaultStatusFilter(statusCatalog), [statusFilter, statusCatalog])
  const taskStatusByPath = useMemo(() => {
    const map = new Map<string, TaskStatus>()
    for (const n of notes) if (isTaskFile(n)) map.set(n.path, resolveTaskStatus(n.status, statusCatalog))
    return map
  }, [notes, statusCatalog])

  async function setTaskStatusByKey(path: string, key: string) {
    const next = statusCatalog.find((s) => s.key === key)
    if (!next) throw new Error(`Unknown status "${key}".`)
    return updateTaskStatus(path, next)
  }

  function toggleStatus(key: string) {
    const current = new Set(effectiveStatusFilter)
    if (current.has(key)) current.delete(key)
    else current.add(key)
    setStatusFilter([...current])
  }

  const counts = useMemo(() => tagCounts(notes), [notes])
  const allTags = useMemo(() => uniqueTags(notes), [notes])
  const dateRangeActive = Boolean(dateFrom || dateTo)

  const filtered = useMemo(() => {
    // The note currently open never gets filtered out of its own list — editing a note's
    // tags to no longer match the active tag filter shouldn't make it vanish mid-edit.
    let list = notes.filter((n) => viewMatchesSource(view, n.source) || n.path === selectedPath)
    if (view === "tasks") {
      const allowed = new Set(effectiveStatusFilter)
      list = list.filter((n) => {
        const status = taskStatusByPath.get(n.path)
        return !status || allowed.has(status.key) || n.path === selectedPath
      })
    }
    if (activeTag) list = list.filter((n) => n.tags.includes(activeTag) || n.path === selectedPath)
    if (dateFrom || dateTo) {
      list = list.filter(
        (n) => (n.date && (!dateFrom || n.date >= dateFrom) && (!dateTo || n.date <= dateTo)) || n.path === selectedPath,
      )
    }
    return list
  }, [notes, view, effectiveStatusFilter, taskStatusByPath, activeTag, dateFrom, dateTo, selectedPath])

  const selected = notes.find((n) => n.path === selectedPath) ?? filtered[0] ?? null
  const connected = status === "connected"

  // Pull requests view: the PRS.md ledger, filtered like the notes list (the open PR stays listed).
  const ledgerPrs = useMemo(() => prLedger?.prs ?? [], [prLedger])
  const prCounts = useMemo(() => countByState(ledgerPrs), [ledgerPrs])
  const prRepos = useMemo(() => reposIn(ledgerPrs.filter((p) => p.state === prState)), [ledgerPrs, prState])
  // A repo filter left active after its last PR in this state merged/closed would silently hide
  // everything — it stops applying once that repo has nothing left here.
  const activePrRepo = prRepo && prRepos.includes(prRepo) ? prRepo : null
  const visiblePrs = useMemo(
    () => filterPrs(ledgerPrs, { state: prState, repo: activePrRepo, dateFrom, dateTo, keepKey: selectedPrKey }),
    [ledgerPrs, prState, activePrRepo, dateFrom, dateTo, selectedPrKey],
  )
  const selectedPr = ledgerPrs.find((p) => p.key === selectedPrKey) ?? visiblePrs[0] ?? null
  const tasksByPr = useMemo(() => tasksByPrKey(notes), [notes])

  function showPrs(state: PrState, key: string | null = null) {
    setView("prs")
    setPrState(state)
    setPrRepo(null)
    setSelectedPrKey(key)
  }

  function openTask(path: string) {
    setView("tasks")
    setSelectedPath(path)
  }

  // Same as notes: pin the first listed PR as the real selection once one shows.
  useEffect(() => {
    if (!selectedPrKey && visiblePrs[0]) setSelectedPrKey(visiblePrs[0].key)
  }, [selectedPrKey, visiblePrs])

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
    <>
      <Sidebar>
        <SidebarHeader>
          <WorkspaceSwitcher
            workspaces={workspaces}
            active={activeWorkspace}
            onSwitch={switchWorkspace}
            onAdd={addFolder}
            onStartDemo={startDemo}
            onExitDemo={exitDemo}
            onRename={renameWorkspace}
            onRemove={removeWorkspace}
            onLocate={locateWorkspace}
            onOpen={refreshAvailability}
          />
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
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "prs"} onClick={() => setView("prs")}>
                    <GitPullRequest />
                    Pull requests
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {view === "tasks" && (
            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center justify-between">
                Status
                {statusFilter && (
                  <button onClick={() => setStatusFilter(null)} className="font-normal text-primary normal-case">
                    Reset
                  </button>
                )}
              </SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-wrap gap-1.5 px-2">
                {statusCatalog.map((s) => {
                  const on = effectiveStatusFilter.includes(s.key)
                  return (
                    <button
                      key={s.key}
                      onClick={() => toggleStatus(s.key)}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <TaskStatusDot status={s} />
                      {s.label}
                    </button>
                  )
                })}
              </SidebarGroupContent>
            </SidebarGroup>
          )}

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

          {view !== "prs" && (
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
          )}
        </SidebarContent>

        <SidebarFooter className="gap-2">
          {!supported ? (
            <div className="flex items-start gap-2 rounded-lg bg-muted p-2 text-[11px] leading-snug text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Needs Chrome 133+ for the File System Access API and FileSystemObserver.
            </div>
          ) : status === "needs-permission" ? (
            <Button variant="outline" size="sm" className="justify-start gap-2" onClick={reopenActive} disabled={busy}>
              <KeyRound className="size-3.5" />
              Grant access {folderName ? `to "${folderName}"` : ""}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="justify-start gap-2" onClick={addWorkspace} disabled={busy}>
              <FolderOpen className="size-3.5" />
              {workspaces.some((ws) => !ws.demo) ? "Add folder" : "Connect folder"}
            </Button>
          )}

          {(supported || inDemo) && (
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              <Radio
                className={`size-3 ${connected && !inDemo ? "animate-pulse text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              />
              {busy
                ? "Connecting…"
                : connected
                  ? `${inDemo ? "Demo" : "Watching"} · ${folderName}`
                  : status === "needs-permission"
                    ? "Permission needed"
                    : status === "unavailable"
                      ? "Folder unavailable"
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
            disabled={!connected && workspaces.length === 0}
            className="ml-auto gap-2 text-muted-foreground"
          >
            <Search className="size-3.5" />
            Search notes…
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
          </Button>
          <ThemeSwitcher />
          <Button variant="outline" size="icon" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="h-full w-full max-w-md shrink-0 overflow-y-auto border-r border-border">
            <div className="space-y-4 p-3">
              {notice && (
                <div role="status" className="flex items-start gap-2 rounded-lg border border-border bg-muted/60 p-2.5 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span className="flex-1">{notice}</span>
                  <button onClick={dismissNotice} aria-label="Dismiss" className="hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              {connected && inDemo && (
                <div role="status" className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-xs text-muted-foreground">
                  <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span className="flex-1">
                    <span className="font-medium text-foreground">Demo workspace.</span> Sample notes, plans, tasks and PRs
                    kept in memory: edit freely, nothing is saved. Switch between Work and Personal from the folder
                    menu.
                  </span>
                  <button onClick={exitDemo} className="shrink-0 font-medium text-primary hover:underline">
                    Exit demo
                  </button>
                </div>
              )}
              {!connected && (
                <div className="space-y-3 p-4 text-sm text-muted-foreground">
                  {busy ? (
                    <p>Opening {folderName ? `"${folderName}"` : "folder"}…</p>
                  ) : status === "needs-permission" ? (
                    <>
                      <p>The browser needs your permission again to read "{folderName}".</p>
                      <Button size="sm" className="gap-2" onClick={reopenActive}>
                        <KeyRound className="size-3.5" />
                        Grant access
                      </Button>
                    </>
                  ) : status === "unavailable" && activeWorkspace ? (
                    <>
                      <p className="font-medium text-foreground">Folder unavailable</p>
                      <p>{error ?? `"${folderName}" couldn't be opened.`}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="gap-2" onClick={reopenActive}>
                          <RefreshCw className="size-3.5" />
                          Retry
                        </Button>
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => locateWorkspace(activeWorkspace.id)}>
                          <FolderSearch className="size-3.5" />
                          Locate…
                        </Button>
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => removeWorkspace(activeWorkspace.id)}>
                          <Trash2 className="size-3.5" />
                          Remove from list
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      {supported ? (
                        <p>
                          Connect your notes repo (the folder with a <code className="font-mono">db/</code> folder inside) to
                          browse your notes, plans, tasks and daily logs.
                        </p>
                      ) : (
                        <p>
                          Connecting a notes folder needs a Chromium-based browser (Chrome 133+, Edge, Arc, Brave). You can
                          still look around with sample data.
                        </p>
                      )}
                      <p>
                        Not ready to connect one yet? Try the demo: two sample workspaces, <strong>Work</strong> and{" "}
                        <strong>Personal</strong>, with notes, plans, daily plans, tasks and pull requests.
                      </p>
                      <Button size="sm" variant={supported ? "outline" : "default"} className="gap-2" onClick={startDemo}>
                        <FlaskConical className="size-3.5" />
                        Try the demo
                      </Button>
                    </>
                  )}
                </div>
              )}
              {connected && layout === "unrecognized" && notes.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  "{folderName}" has no <code className="font-mono">db/</code>, <code className="font-mono">notes/</code> or{" "}
                  <code className="font-mono">plans/</code> folder. Pick your notes repo (or its{" "}
                  <code className="font-mono">db/</code> folder) with <strong>Add folder</strong>.
                </p>
              )}
              {connected && view === "prs" && (
                <PrList
                  prs={visiblePrs}
                  counts={prCounts}
                  repos={prRepos}
                  state={prState}
                  onStateChange={(state) => showPrs(state)}
                  repo={activePrRepo}
                  onRepoChange={(repo) => {
                    setPrRepo(repo)
                    setSelectedPrKey(null)
                  }}
                  selectedKey={selectedPr?.key ?? null}
                  onSelect={setSelectedPrKey}
                  ledgerFound={prLedger !== null}
                  filtered={Boolean(activePrRepo || dateFrom || dateTo)}
                  lastDeepCheck={prLedger?.lastDeepCheck ?? null}
                />
              )}
              {connected && view !== "prs" && layout !== "unrecognized" && filtered.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No notes in this view yet.</p>
              )}
              {view !== "prs" && groupNotesByDate(filtered).map((group) => (
                <div key={group.date ?? "no-date"}>
                  <div className="mb-2 flex items-baseline justify-between px-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span>{formatDateHeading(group.date)}</span>
                    <span className="normal-case text-muted-foreground/70">
                      {group.notes.length} {group.notes.length === 1 ? "note" : "notes"}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.notes.map((note) => {
                      const taskStatus = taskStatusByPath.get(note.path)
                      return (
                      <button
                        key={note.path}
                        onClick={() => setSelectedPath(note.path)}
                        className={`block w-full rounded-lg border p-3 text-left transition-colors ${
                          note.path === selected?.path
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                          {taskStatus && <TaskStatusDot status={taskStatus} />}
                          <span className="min-w-0">{note.title}</span>
                        </div>
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          {note.type && (
                            <Badge variant="secondary" className="text-[10px]">
                              {note.type}
                            </Badge>
                          )}
                          {!taskStatus && displayStatus(note.status) && (
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
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="h-full min-w-0 flex-1 overflow-y-auto">
            {view === "prs" ? (
              connected && selectedPr ? (
                <PrDetail
                  key={selectedPr.key}
                  pr={selectedPr}
                  tasks={tasksByPr.get(selectedPr.key) ?? []}
                  taskStatusByPath={taskStatusByPath}
                  onOpenTask={openTask}
                />
              ) : (
                <div className="mx-auto flex h-full max-w-2xl items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {connected ? "Select a pull request to see its details." : "Nothing to show yet."}
                </div>
              )
            ) : selected ? (
              <NoteDetail
                key={selected.path}
                note={selected}
                onSave={saveNote}
                allTags={allTags}
                taskStatus={taskStatusByPath.get(selected.path) ?? null}
                taskStatuses={statusCatalog}
                onSetTaskStatus={setTaskStatusByKey}
              />
            ) : (
              <div className="mx-auto flex h-full max-w-2xl items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {connected ? "Select a note to read it." : "Nothing to show yet."}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>

      <CommandPalette
        notes={notes}
        taskStatusByPath={taskStatusByPath}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspace?.id ?? null}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSelectNote={(path) => {
          if (view === "prs") setView("all")
          setSelectedPath(path)
        }}
        prs={ledgerPrs}
        onSelectPr={(pr) => showPrs(pr.state, pr.key)}
        onSwitchWorkspace={switchWorkspace}
        onAddWorkspace={addFolder}
        onStartDemo={startDemo}
        onExitDemo={exitDemo}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <StatusSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} catalog={statusCatalog} settings={statusSettings} />
    </>
  )
}
