import { useEffect, useMemo, useState } from "react"
import { ChevronDown, GitPullRequest } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { PendingPr } from "@/lib/prs-parser"

const COLLAPSE_KEY = "ainotes-prs-widget-collapsed"

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1"
  } catch {
    return false
  }
}

function CiChip({ ci }: { ci: string | null }) {
  if (!ci) return null
  const failing = ci.startsWith("🔴")
  const passing = ci.startsWith("🟢")
  const label = ci.replace(/^[🔴🟢]\s*/u, "")
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        failing && "bg-red-600/10 text-red-700 dark:text-red-400",
        passing && "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
        !failing && !passing && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  )
}

function PrRow({ pr }: { pr: PendingPr }) {
  const hasUnresolved = pr.unresolvedComments && pr.unresolvedComments.toLowerCase() !== "none"
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-md border border-border p-2.5 transition-colors hover:border-primary/50"
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-semibold">#{pr.number}</span>
        <Badge variant="secondary" className="text-[10px]">
          {pr.repo}
        </Badge>
        {pr.jira && (
          <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
            {pr.jira}
          </span>
        )}
        <CiChip ci={pr.ci} />
        {pr.behindMain === "Yes" && (
          <span className="rounded bg-amber-600/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            Behind main
          </span>
        )}
      </div>
      {pr.title && <div className="mb-1 text-xs text-foreground">{pr.title}</div>}
      {(pr.openFor || pr.lastCommit) && (
        <div className="mb-1 font-mono text-[10.5px] text-muted-foreground/80">
          {[pr.openFor && `Open ${pr.openFor}`, pr.lastCommit && `Last commit ${pr.lastCommit}`].filter(Boolean).join(" · ")}
        </div>
      )}
      {pr.reviews && <div className="text-[11px] text-muted-foreground">{pr.reviews}</div>}
      {hasUnresolved && (
        <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">⚠ {pr.unresolvedComments}</div>
      )}
    </a>
  )
}

export function PendingPrs({ prs }: { prs: PendingPr[] }) {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)
  const [repoFilter, setRepoFilter] = useState<string | null>(null)

  // prs already arrives sorted by repo then PR number (prs-parser.ts).
  const repos = useMemo(() => [...new Set(prs.map((p) => p.repo))], [prs])
  const visiblePrs = repoFilter ? prs.filter((p) => p.repo === repoFilter) : prs

  // A repo filter left active after its last pending PR merges/closes would silently
  // hide everything with no visible way to tell why — drop it once it's stale.
  useEffect(() => {
    if (repoFilter && !repos.includes(repoFilter)) setRepoFilter(null)
  }, [repoFilter, repos])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <button onClick={toggle} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-xs font-medium">
          <GitPullRequest className="size-3.5" />
          Pending PRs
          <Badge variant="secondary" className="text-[10px]">
            {prs.length}
          </Badge>
        </span>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
      </button>
      {!collapsed && (
        <div className="space-y-2 border-t border-border p-3 pt-2">
          {repos.length > 1 && (
            <div className="flex flex-wrap gap-1.5 pb-0.5">
              {repos.map((repo) => (
                <button
                  key={repo}
                  onClick={() => setRepoFilter(repoFilter === repo ? null : repo)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    repoFilter === repo
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                >
                  {repo}
                </button>
              ))}
            </div>
          )}
          {visiblePrs.map((pr) => (
            <PrRow key={pr.number} pr={pr} />
          ))}
        </div>
      )}
    </div>
  )
}
