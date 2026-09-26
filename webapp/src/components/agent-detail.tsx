import { ExternalLink, GitPullRequest } from "lucide-react"

import { AgentStatusChip } from "@/components/agent-status-chip"
import { Field, FieldList, Section } from "@/components/detail-section"
import { Pill, ToneChip } from "@/components/pr-hints"
import { Button } from "@/components/ui/button"
import {
  agentLocation,
  agentName,
  agentStatus,
  formatTokens,
  linkLabel,
  timeAgo,
  type Agent,
  type AgentLink,
} from "@/lib/agents"
import { EXTERNAL_LINK } from "@/lib/links"
import { prKeyFromRef, type LedgerPr } from "@/lib/prs-parser"

function When({ iso, now }: { iso: string; now: number }) {
  return (
    <>
      {timeAgo(iso, now)} <span className="text-muted-foreground">({new Date(iso).toLocaleString()})</span>
    </>
  )
}

function Overview({ agent, now }: { agent: Agent; now: number }) {
  const tokens = formatTokens(agent.tokens)
  return (
    <FieldList>
      <Field label="Repository">
        <span className="font-mono">{agent.repo ?? "workspace root"}</span>
      </Field>
      {agent.worktree && (
        <Field label="Worktree">
          <span className="font-mono">{agent.worktree}</span>
        </Field>
      )}
      {agent.cwd && (
        <Field label="Folder">
          <span className="font-mono text-xs break-all">{agent.cwd}</span>
        </Field>
      )}
      <Field label="Session">{agent.kind === "interactive" ? "Interactive" : "Background"}</Field>
      {agent.state && <Field label="Job state">{agent.state}</Field>}
      {agent.running && agent.activity && <Field label="Activity">{agent.activity}</Field>}
      {tokens && agent.tokens != null && (
        <Field label="Tokens">
          <span title={agent.tokens.toLocaleString()}>{tokens}</span>
        </Field>
      )}
      {agent.createdAt && (
        <Field label="Started">
          <When iso={agent.createdAt} now={now} />
        </Field>
      )}
      {agent.updatedAt && (
        <Field label="Last update">
          <When iso={agent.updatedAt} now={now} />
        </Field>
      )}
      <Field label="Job">
        <span className="font-mono">{agent.id}</span>
      </Field>
      {agent.pid != null && (
        <Field label="Process">
          <span className="font-mono">{agent.pid}</span>
        </Field>
      )}
      {agent.cliVersion && <Field label="Claude Code">{agent.cliVersion}</Field>}
    </FieldList>
  )
}

function LinkRow({ link, ledgerPr, onOpenPr }: { link: AgentLink; ledgerPr: LedgerPr | null; onOpenPr: (pr: LedgerPr) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-sm">
      <span className="min-w-0 flex-1 font-mono text-xs">{linkLabel(link)}</span>
      <ToneChip tone="neutral">{link.kind === "pr" ? "PR" : link.kind}</ToneChip>
      {ledgerPr && (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => onOpenPr(ledgerPr)}>
          <GitPullRequest className="size-3.5" />
          Show in Pull requests
        </Button>
      )}
      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" asChild>
        <a href={link.href} {...EXTERNAL_LINK}>
          <ExternalLink className="size-3.5" />
          Open
        </a>
      </Button>
    </li>
  )
}

export function AgentDetail({
  agent,
  now,
  prsByKey,
  onOpenPr,
}: {
  agent: Agent
  now: number
  // The PR ledger, so a linked PR can open in the Pull requests view.
  prsByKey: Map<string, LedgerPr>
  onOpenPr: (pr: LedgerPr) => void
}) {
  return (
    <article className="mx-auto max-w-2xl p-6 lg:p-10">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <AgentStatusChip status={agentStatus(agent)} />
        {agent.kind === "interactive" && <ToneChip tone="neutral">Interactive</ToneChip>}
        {agent.pinned && <Pill className="text-[11px]">pinned</Pill>}
      </div>

      <h1 className="mb-1.5 text-lg font-semibold tracking-tight">{agentName(agent)}</h1>
      <div className="mb-6 font-mono text-xs text-muted-foreground">{agentLocation(agent)}</div>

      {agent.detail && (
        <Section title="Last status">
          <p className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-sm leading-relaxed break-words">{agent.detail}</p>
        </Section>
      )}

      <Section title="Overview">
        <Overview agent={agent} now={now} />
      </Section>

      {agent.links.length > 0 && (
        <Section title="Links">
          <ul className="space-y-2">
            {agent.links.map((link) => {
              const key = link.kind === "pr" ? prKeyFromRef(link.href) : null
              return <LinkRow key={link.href} link={link} ledgerPr={key ? (prsByKey.get(key) ?? null) : null} onOpenPr={onOpenPr} />
            })}
          </ul>
        </Section>
      )}
    </article>
  )
}
