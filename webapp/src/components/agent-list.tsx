import { AgentStatusChip } from "@/components/agent-status-chip"
import { ListGroupHeading } from "@/components/detail-section"
import { FilterChip } from "@/components/filter-chip"
import { Pill, ToneChip } from "@/components/pr-hints"
import { Badge } from "@/components/ui/badge"
import {
  AGENT_FILTERS,
  agentLocation,
  agentName,
  agentStatus,
  formatTokens,
  timeAgo,
  type Agent,
  type AgentFilter,
  type AgentStatusGroup,
} from "@/lib/agents"
import { cn } from "@/lib/utils"

function AgentRow({ agent, now, selected, onSelect }: { agent: Agent; now: number; selected: boolean; onSelect: () => void }) {
  const status = agentStatus(agent)
  const meta = [
    formatTokens(agent.tokens) && `${formatTokens(agent.tokens)} tokens`,
    agent.updatedAt && `updated ${timeAgo(agent.updatedAt, now)}`,
  ].filter(Boolean)
  return (
    <button
      onClick={onSelect}
      className={cn(
        "block w-full rounded-lg border p-3 text-left transition-colors",
        status === "waiting" && "needs-you-card",
        selected ? "border-primary bg-primary/10" : status !== "waiting" && "border-border hover:border-primary/50",
      )}
    >
      <div className="mb-1 text-sm font-semibold">{agentName(agent)}</div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {agentLocation(agent)}
        </Badge>
        <AgentStatusChip status={status} />
        {agent.kind === "interactive" && <ToneChip tone="neutral">Interactive</ToneChip>}
        {agent.links.length > 0 && (
          <ToneChip tone="neutral">
            {agent.links.length} {agent.links.length === 1 ? "link" : "links"}
          </ToneChip>
        )}
      </div>
      {agent.detail && <p className="mb-1.5 line-clamp-2 text-xs text-muted-foreground">{agent.detail}</p>}
      {meta.length > 0 && <div className="mb-1 font-mono text-[10.5px] text-muted-foreground/80">{meta.join(" · ")}</div>}
      {agent.pinned && (
        <div className="flex flex-wrap gap-1">
          <Pill>pinned</Pill>
        </div>
      )}
    </button>
  )
}

function EmptyState({ filter, snapshotFound }: { filter: AgentFilter; snapshotFound: boolean }) {
  const label = AGENT_FILTERS.find((f) => f.filter === filter)?.label.toLowerCase() ?? filter
  return (
    <div className="space-y-1.5 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{snapshotFound ? `No agents under ${label}` : "No agent snapshot yet"}</p>
      <p className="text-xs leading-relaxed">
        {snapshotFound ? "" : <>This folder has no <code className="font-mono">AGENTS.json</code> yet. </>}
        The agent snapshot (<code className="font-mono">AGENTS.json</code>) is written by{" "}
        <code className="font-mono">tools/snapshot-agents.sh</code>. Schedule it every minute to keep this view current.
      </p>
    </div>
  )
}

export function AgentList({
  groups,
  counts,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  snapshotFound,
  generatedAt,
  stale,
  now,
}: {
  // Already filtered and grouped by status (groupAgents).
  groups: AgentStatusGroup[]
  counts: Record<AgentFilter, number>
  filter: AgentFilter
  onFilterChange: (filter: AgentFilter) => void
  selectedId: string | null
  onSelect: (id: string) => void
  snapshotFound: boolean
  generatedAt: string | null
  // The snapshot is older than the script's schedule allows, so it has probably stopped.
  stale: boolean
  now: number
}) {
  return (
    <>
      <div className="space-y-2 px-1">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Agent status">
          {AGENT_FILTERS.map((f) => (
            <FilterChip key={f.filter} on={filter === f.filter} onClick={() => onFilterChange(f.filter)}>
              {f.label} <span className="opacity-60">{counts[f.filter]}</span>
            </FilterChip>
          ))}
        </div>
        {generatedAt && (
          <p className={`font-mono text-[10.5px] ${stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/80"}`}>
            Snapshot {timeAgo(generatedAt, now)}
            {stale && " · is snapshot-agents.sh still scheduled?"}
          </p>
        )}
      </div>

      {groups.length === 0 && <EmptyState filter={filter} snapshotFound={snapshotFound} />}

      {groups.map((group) => (
        <div key={group.status}>
          <ListGroupHeading
            label={
              group.status === "waiting" ? (
                <span className="needs-you-heading">
                  <span className="needs-you-dot" aria-hidden="true" />
                  {group.label}
                </span>
              ) : (
                group.label
              )
            }
            count={group.agents.length}
            unit={["agent", "agents"]}
          />
          <div className="space-y-2">
            {group.agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} now={now} selected={agent.id === selectedId} onSelect={() => onSelect(agent.id)} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
