import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, FlaskConical, FolderOpen, FolderSearch, KeyRound, Radio, RefreshCw, Search, Settings, Sparkles, Trash2, X } from "lucide-react"

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
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { AgentDetail } from "@/components/agent-detail"
import { AgentList } from "@/components/agent-list"
import { LibraryMenu, type LibraryCount } from "@/components/library-menu"
import { CollapsibleSidebarGroup, SidebarGroupAction } from "@/components/collapsible-sidebar-group"
import { CommandPalette } from "@/components/command-palette"
import { DateRangeFilter } from "@/components/date-range-filter"
import { NoteDetail } from "@/components/note-detail"
import { NewVersionBanner } from "@/components/new-version-banner"
import { PrDetail } from "@/components/pr-detail"
import { PrList } from "@/components/pr-list"
import { StatusSettingsDialog } from "@/components/status-settings-dialog"
import { TaskStatusDot } from "@/components/task-status-dot"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { useNotesDirectory, type NotesDirectory } from "@/hooks/use-notes-directory"
import { useNow } from "@/hooks/use-now"
import { agentStatus, countByFilter, groupAgents, SNAPSHOT_STALE_AFTER_MS, type AgentFilter } from "@/lib/agents"
import { DEFAULT_DATE_RANGE, describeDateRange, resolveDateRange, type DateRangeFilter as DateRange } from "@/lib/date-range"
import { useSelectedView, type LibraryView } from "@/lib/library-order"
import { displayStatus, displayTag, formatDateHeading, groupNotesByDate, uniqueTags, type Note, type NoteSource } from "@/lib/notes-frontmatter"
import { countByState, filterPrs, reposIn, tasksByPrKey } from "@/lib/pr-view"
import type { LedgerPr, PrState } from "@/lib/prs-parser"
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
const PROJECT_REPO_URL = "https://github.com/garrefa/ai-notes"
// How often relative times in the Agents view ("updated 3m ago") are recomputed.
const CLOCK_TICK_MS = 30_000
const TAGS_COLLAPSE_KEY = "ainotes-tags-collapsed"

// lucide-react dropped brand icons, so the GitHub mark is drawn inline.
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

type View = LibraryView

// Views that list notes; the others (PRs, agents) list ledger entries with their own filters.
function isNoteView(view: View) {
  return view !== "prs" && view !== "agents"
}

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
  return isNoteView(view)
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
      <NewVersionBanner />
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
    agents,
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

  const [view, setView] = useSelectedView()
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [tagQuery, setTagQuery] = useState("")
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE)
  const { from: dateFrom, to: dateTo } = useMemo(() => resolveDateRange(dateRange), [dateRange])
  const dateRangeSummary = describeDateRange(dateRange)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // null = the default: every status that isn't closed.
  const [statusFilter, setStatusFilter] = useState<string[] | null>(null)
  const [prState, setPrState] = useState<PrState>("pending")
  const [prRepo, setPrRepo] = useState<string | null>(null)
  const [selectedPrKey, setSelectedPrKey] = useState<string | null>(null)
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("running")
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const clock = useNow(CLOCK_TICK_MS)

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

  // Agents view: the AGENTS.json snapshot, grouped by status (the open agent stays listed).
  const snapshotAgents = useMemo(() => agents?.agents ?? [], [agents])
  const agentCounts = useMemo(() => countByFilter(snapshotAgents), [snapshotAgents])
  const agentGroups = useMemo(
    () => groupAgents(snapshotAgents, agentFilter, selectedAgentId),
    [snapshotAgents, agentFilter, selectedAgentId],
  )
  const firstListedAgent = agentGroups[0]?.agents[0] ?? null
  const selectedAgent = snapshotAgents.find((a) => a.id === selectedAgentId) ?? firstListedAgent
  // A demo snapshot is frozen, so its ages are measured from when it was taken.
  const now = inDemo && agents ? Date.parse(agents.generatedAt) : clock
  const snapshotStale = agents !== null && now - Date.parse(agents.generatedAt) > SNAPSHOT_STALE_AFTER_MS
  const prsByKey = useMemo(() => new Map(ledgerPrs.map((p) => [p.key, p])), [ledgerPrs])

  // The Library badges: what each view lists before any tag or date filter.
  const libraryCounts = useMemo<Partial<Record<View, LibraryCount>>>(() => {
    const bySource = (source: NoteSource) => notes.filter((n) => n.source === source).length
    const openTasks = [...taskStatusByPath.values()].filter((s) => !s.closed).length
    const waitingAgents = snapshotAgents.filter((a) => agentStatus(a) === "waiting").length
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    return {
      all: { count: notes.length, title: plural(notes.length, "note", "notes") },
      notes: { count: bySource("notes"), title: plural(bySource("notes"), "note", "notes") },
      plans: { count: bySource("plans"), title: plural(bySource("plans"), "plan", "plans") },
      daily: { count: bySource("daily"), title: plural(bySource("daily"), "daily plan", "daily plans") },
      tasks: { count: openTasks, title: plural(openTasks, "open task", "open tasks") },
      prs: { count: prCounts.pending, title: plural(prCounts.pending, "pending PR", "pending PRs") },
      agents:
        waitingAgents > 0
          ? {
              count: waitingAgents,
              alert: true,
              title: `${plural(waitingAgents, "agent needs", "agents need")} you · ${agentCounts.running} running`,
            }
          : { count: agentCounts.running, title: plural(agentCounts.running, "running agent", "running agents") },
    }
  }, [notes, taskStatusByPath, snapshotAgents, prCounts, agentCounts])

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

  function openPr(pr: LedgerPr) {
    showPrs(pr.state, pr.key)
  }

  // Same as notes and PRs: pin the first listed agent as the real selection once one shows.
  useEffect(() => {
    if (!selectedAgentId && firstListedAgent) setSelectedAgentId(firstListedAgent.id)
  }, [selectedAgentId, firstListedAgent])

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
          <LibraryMenu view={view} onViewChange={setView} counts={connected ? libraryCounts : {}} />

          {view === "tasks" && (
            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center justify-between">
                Status
                {statusFilter && <SidebarGroupAction onClick={() => setStatusFilter(null)}>Reset</SidebarGroupAction>}
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

          {view !== "agents" && <DateRangeFilter value={dateRange} onChange={setDateRange} />}

          {isNoteView(view) && (
            <CollapsibleSidebarGroup
              title="Tags"
              storageKey={TAGS_COLLAPSE_KEY}
              summary={activeTag && displayTag(activeTag)}
              action={activeTag && <SidebarGroupAction onClick={() => setActiveTag(null)}>Clear</SidebarGroupAction>}
              contentClassName="space-y-2 px-2"
            >
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
            </CollapsibleSidebarGroup>
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
          <Button variant="outline" size="icon" asChild>
            <a href={PROJECT_REPO_URL} target="_blank" rel="noreferrer" aria-label="AINotes on GitHub" title="AINotes on GitHub">
              <GitHubMark />
            </a>
          </Button>
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
                    <span className="font-medium text-foreground">Demo workspace.</span> Sample notes, plans, tasks, PRs and agents
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
                          Connect your notes repo to browse your notes, plans, tasks and daily logs.
                        </p>
                      ) : (
                        <p>
                          Connecting a notes folder needs a Chromium-based browser (Chrome 133+, Edge, Arc, Brave). You can
                          still look around with sample data.
                        </p>
                      )}
                      <p>
                        Not ready to connect one yet? Try the demo: two sample workspaces, <strong>Work</strong> and{" "}
                        <strong>Personal</strong>, with notes, plans, daily plans, tasks, pull requests and agents.
                      </p>
                      <Button className="demo-cta h-9 gap-2 px-5 font-semibold" onClick={startDemo}>
                        <Sparkles className="size-4" />
                        Try the demo
                      </Button>
                    </>
                  )}
                </div>
              )}
              {connected && layout === "unrecognized" && notes.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  "{folderName}" has no <code className="font-mono">notes/</code> or{" "}
                  <code className="font-mono">plans/</code> folder (nor a legacy{" "}
                  <code className="font-mono">db/</code> folder). Pick your notes repo with{" "}
                  <strong>Add folder</strong>.
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
              {connected && view === "agents" && (
                <AgentList
                  groups={agentGroups}
                  counts={agentCounts}
                  filter={agentFilter}
                  onFilterChange={(filter) => {
                    setAgentFilter(filter)
                    setSelectedAgentId(null)
                  }}
                  selectedId={selectedAgent?.id ?? null}
                  onSelect={setSelectedAgentId}
                  snapshotFound={agents !== null}
                  generatedAt={agents?.generatedAt ?? null}
                  stale={snapshotStale && !inDemo}
                  now={now}
                />
              )}
              {connected && isNoteView(view) && layout !== "unrecognized" && filtered.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {dateRangeSummary && notes.some((n) => viewMatchesSource(view, n.source))
                    ? `Nothing here in the selected range (${dateRangeSummary}). Widen the date range to see older notes.`
                    : "No notes in this view yet."}
                </p>
              )}
              {isNoteView(view) && groupNotesByDate(filtered).map((group) => (
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
            {view === "agents" ? (
              connected && selectedAgent ? (
                <AgentDetail key={selectedAgent.id} agent={selectedAgent} now={now} prsByKey={prsByKey} onOpenPr={openPr} />
              ) : (
                <div className="mx-auto flex h-full max-w-2xl items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {connected ? "Select an agent to see its details." : "Nothing to show yet."}
                </div>
              )
            ) : view === "prs" ? (
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
          if (!isNoteView(view)) setView("all")
          setSelectedPath(path)
        }}
        prs={ledgerPrs}
        onSelectPr={openPr}
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
