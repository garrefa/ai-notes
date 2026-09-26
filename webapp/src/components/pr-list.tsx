import { ListGroupHeading } from "@/components/detail-section"
import { FilterChip } from "@/components/filter-chip"
import { Badge } from "@/components/ui/badge"
import { Pill, ToneChip } from "@/components/pr-hints"
import type { LedgerPr, PrState } from "@/lib/prs-parser"
import {
  PR_STATES,
  formatAge,
  groupPrsByRepo,
  parseBehind,
  parseCi,
  parseUnresolved,
  prTitle,
  reviewSummary,
} from "@/lib/pr-view"

function ageLine(pr: LedgerPr): string {
  if (pr.state !== "pending") {
    const verb = pr.state === "merged" ? "merged" : "closed"
    return [pr.opened && `Opened ${pr.opened}`, pr.resolved && `${verb} ${pr.resolved}`].filter(Boolean).join(" · ")
  }
  const openFor = formatAge(pr.detail?.openFor ?? null)
  const lastCommit = formatAge(pr.detail?.lastCommit ?? null)
  return [
    openFor ? `Open ${openFor}` : pr.opened && `Opened ${pr.opened}`,
    lastCommit && `last commit ${lastCommit === "today" ? "today" : `${lastCommit} ago`}`,
  ]
    .filter(Boolean)
    .join(" · ")
}

function PrRow({ pr, selected, onSelect }: { pr: LedgerPr; selected: boolean; onSelect: () => void }) {
  const ci = parseCi(pr.detail?.ci ?? null)
  const review = reviewSummary(pr.detail?.reviews ?? null)
  const behind = parseBehind(pr.detail?.behindMain ?? null)
  const unresolved = parseUnresolved(pr.detail?.unresolvedComments ?? null)
  const age = ageLine(pr)
  return (
    <button
      onClick={onSelect}
      className={`block w-full rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
      }`}
    >
      <div className="mb-1 text-sm font-semibold">{prTitle(pr)}</div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {pr.repo}#{pr.number}
        </Badge>
        {pr.state === "merged" && <ToneChip tone="good">Merged</ToneChip>}
        {pr.state === "closed" && <ToneChip tone="neutral">Closed</ToneChip>}
        {ci && <ToneChip tone={ci.tone}>{ci.label}</ToneChip>}
        {review && <ToneChip tone={review.tone}>{review.label}</ToneChip>}
        {behind && behind.tone !== "good" && <ToneChip tone={behind.tone}>{behind.label}</ToneChip>}
        {unresolved && unresolved.count > 0 && (
          <ToneChip tone="warn">
            {unresolved.count} unresolved {unresolved.count === 1 ? "comment" : "comments"}
          </ToneChip>
        )}
      </div>
      {age && <div className="mb-1 font-mono text-[10.5px] text-muted-foreground/80">{age}</div>}
      {pr.jira && (
        <div className="flex flex-wrap gap-1">
          <Pill>{pr.jira}</Pill>
        </div>
      )}
    </button>
  )
}

function EmptyState({ state, ledgerFound, filtered }: { state: PrState; ledgerFound: boolean; filtered: boolean }) {
  const label = PR_STATES.find((s) => s.state === state)?.label.toLowerCase() ?? state
  return (
    <div className="space-y-1.5 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{filtered ? `No ${label} PRs match the filters` : `No ${label} PRs`}</p>
      <p className="text-xs leading-relaxed">
        {ledgerFound ? "" : <>This folder has no <code className="font-mono">PRS.md</code> yet. </>}
        The PR ledger (<code className="font-mono">PRS.md</code>) is maintained by the{" "}
        <code className="font-mono">check prs</code> command (the ainotes-pr-tracker skill) and{" "}
        <code className="font-mono">tools/check-prs.sh</code>.
      </p>
    </div>
  )
}

export function PrList({
  prs,
  counts,
  repos,
  state,
  onStateChange,
  repo,
  onRepoChange,
  selectedKey,
  onSelect,
  ledgerFound,
  filtered,
  lastDeepCheck,
}: {
  // Already filtered and sorted (repo, then number).
  prs: LedgerPr[]
  counts: Record<PrState, number>
  // Repos that have a PR in the current state, for the filter chips.
  repos: string[]
  state: PrState
  onStateChange: (state: PrState) => void
  repo: string | null
  onRepoChange: (repo: string | null) => void
  selectedKey: string | null
  onSelect: (key: string) => void
  ledgerFound: boolean
  // A date range or repo filter is active.
  filtered: boolean
  lastDeepCheck: string | null
}) {
  return (
    <>
      <div className="space-y-2 px-1">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="PR state">
          {PR_STATES.map((s) => (
            <FilterChip key={s.state} on={state === s.state} onClick={() => onStateChange(s.state)}>
              {s.label} <span className="opacity-60">{counts[s.state]}</span>
            </FilterChip>
          ))}
        </div>
        {repos.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repository">
            {repos.map((r) => (
              <FilterChip key={r} on={repo === r} onClick={() => onRepoChange(repo === r ? null : r)}>
                {r}
              </FilterChip>
            ))}
          </div>
        )}
        {state === "pending" && lastDeepCheck && (
          <p className="font-mono text-[10.5px] text-muted-foreground/80">Last deep check {lastDeepCheck}</p>
        )}
      </div>

      {prs.length === 0 && <EmptyState state={state} ledgerFound={ledgerFound} filtered={filtered} />}

      {groupPrsByRepo(prs).map((group) => (
        <div key={group.repo}>
          <ListGroupHeading label={group.repo} count={group.prs.length} unit={["PR", "PRs"]} />
          <div className="space-y-2">
            {group.prs.map((pr) => (
              <PrRow key={pr.key} pr={pr} selected={pr.key === selectedKey} onSelect={() => onSelect(pr.key)} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
