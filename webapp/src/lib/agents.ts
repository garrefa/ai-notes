// Reads AGENTS.json, the snapshot of the Claude Code agents working in this workspace that
// tools/snapshot-agents.sh rewrites (every 60s when scheduled). Its shape is owned by that
// script's jq program; keep the two in step.

import type { Tone } from "@/lib/pr-view"

export interface AgentLink {
  kind: string
  id: string
  href: string
  title?: string
}

export interface Agent {
  id: string
  name: string | null
  kind: "bg" | "interactive"
  running: boolean
  // What a live session reports; null once its process is gone.
  activity: "busy" | "idle" | null
  // What a background job reports (e.g. "blocked", "done"); null for interactive sessions.
  state: string | null
  // The job's last status line, clipped by the script.
  detail: string | null
  pid: number | null
  cwd: string | null
  // First folder under the workspace root; null when the agent runs at the root itself.
  repo: string | null
  worktree: string | null
  tokens: number | null
  links: AgentLink[]
  pinned: boolean
  createdAt: string | null
  updatedAt: string | null
  cliVersion: string | null
}

export interface AgentsSnapshot {
  generatedAt: string
  host: string | null
  workspace: string | null
  agents: Agent[]
}

export type AgentStatus = "waiting" | "working" | "idle" | "stopped"

export const AGENT_STATUSES: { status: AgentStatus; label: string; tone: Tone }[] = [
  { status: "waiting", label: "Needs you", tone: "warn" },
  { status: "working", label: "Working", tone: "good" },
  { status: "idle", label: "Idle", tone: "neutral" },
  { status: "stopped", label: "Stopped", tone: "neutral" },
]

export type AgentFilter = "running" | AgentStatus | "all"

export const AGENT_FILTERS: { filter: AgentFilter; label: string }[] = [
  { filter: "running", label: "Running" },
  { filter: "waiting", label: "Needs you" },
  { filter: "stopped", label: "Stopped" },
  { filter: "all", label: "All" },
]

// The script runs every minute; a few missed runs means it has stopped.
export const SNAPSHOT_STALE_AFTER_MS = 3 * 60_000

// A live session reports busy/idle; its job reports blocked when the last turn ended on a
// question for you. Busy wins, since a busy agent isn't waiting on anyone yet.
export function agentStatus(agent: Agent): AgentStatus {
  if (!agent.running) return "stopped"
  if (agent.activity === "busy") return "working"
  if (agent.state === "blocked") return "waiting"
  return "idle"
}

export function agentStatusInfo(status: AgentStatus) {
  return AGENT_STATUSES.find((s) => s.status === status) ?? AGENT_STATUSES[AGENT_STATUSES.length - 1]
}

export function agentName(agent: Agent): string {
  return agent.name ?? agent.id
}

export function parseAgentsSnapshot(raw: string): AgentsSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AgentsSnapshot>
    if (typeof parsed.generatedAt !== "string" || !Array.isArray(parsed.agents)) return null
    return {
      generatedAt: parsed.generatedAt,
      host: parsed.host ?? null,
      workspace: parsed.workspace ?? null,
      agents: parsed.agents.map((a) => ({ ...a, links: Array.isArray(a.links) ? a.links : [] })),
    }
  } catch {
    // The script writes atomically, so a bad parse means a hand-edited or foreign file.
    return null
  }
}

function matchesFilter(agent: Agent, filter: AgentFilter): boolean {
  if (filter === "all") return true
  if (filter === "running") return agent.running
  return agentStatus(agent) === filter
}

export function countByFilter(agents: Agent[]): Record<AgentFilter, number> {
  const counts = Object.fromEntries(AGENT_FILTERS.map((f) => [f.filter, 0])) as Record<AgentFilter, number>
  for (const f of AGENT_FILTERS) counts[f.filter] = agents.filter((a) => matchesFilter(a, f.filter)).length
  return counts
}

export interface AgentStatusGroup {
  status: AgentStatus
  label: string
  agents: Agent[]
}

// Filtered, then grouped by status (needs you first) with the most recently updated first.
// The open agent always stays listed, like the open note and PR do.
export function groupAgents(agents: Agent[], filter: AgentFilter, keepId: string | null): AgentStatusGroup[] {
  const updated = (a: Agent) => (a.updatedAt ? Date.parse(a.updatedAt) : 0)
  const visible = agents
    .filter((a) => matchesFilter(a, filter) || a.id === keepId)
    .sort((a, b) => updated(b) - updated(a))
  return AGENT_STATUSES.map(({ status, label }) => ({
    status,
    label,
    agents: visible.filter((a) => agentStatus(a) === status),
  })).filter((g) => g.agents.length > 0)
}

export function agentLocation(agent: Agent): string {
  const repo = agent.repo ?? "workspace root"
  return agent.worktree ? `${repo} · ${agent.worktree}` : repo
}

export function linkLabel(link: AgentLink): string {
  if (link.kind !== "pr") return link.title ?? link.kind
  const repo = link.href.match(/github\.com\/[^/]+\/([^/]+)/)?.[1]
  return repo ? `${repo}#${link.id}` : `#${link.id}`
}

export function formatTokens(tokens: number | null): string | null {
  if (tokens == null) return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

export function timeAgo(iso: string | null, now: number): string | null {
  if (!iso) return null
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
