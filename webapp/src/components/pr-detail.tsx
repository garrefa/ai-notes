import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"

import { Pill, ToneChip } from "@/components/pr-hints"
import { TaskStatusDot } from "@/components/task-status-dot"
import { Button } from "@/components/ui/button"
import type { Note } from "@/lib/notes-frontmatter"
import type { LedgerPr } from "@/lib/prs-parser"
import {
  formatAge,
  parseBehind,
  parseCi,
  parseCheck,
  parseReviews,
  parseUnresolved,
  prTitle,
  reviewStateHint,
  stateEmoji,
  splitList,
} from "@/lib/pr-view"
import type { TaskStatus } from "@/lib/task-status"

const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer" } as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function JiraValue({ pr }: { pr: LedgerPr }) {
  if (!pr.jira) return null
  if (!pr.jiraUrl) return <span className="font-mono">{pr.jira}</span>
  return (
    <a href={pr.jiraUrl} {...EXTERNAL_LINK} className="font-mono text-primary hover:underline">
      {pr.jira}
    </a>
  )
}

function Overview({ pr }: { pr: LedgerPr }) {
  const openFor = formatAge(pr.detail?.openFor ?? null)
  const lastCommit = formatAge(pr.detail?.lastCommit ?? null)
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
      <Field label="Repository">
        <span className="font-mono">{pr.org ? `${pr.org}/${pr.repo}` : pr.repo}</span>
      </Field>
      {pr.opened && <Field label="Opened">{pr.opened}</Field>}
      {pr.resolved && <Field label={pr.state === "merged" ? "Merged" : "Closed"}>{pr.resolved}</Field>}
      {openFor && <Field label="Open for">{openFor}</Field>}
      {lastCommit && <Field label="Last commit">{lastCommit === "today" ? "today" : `${lastCommit} ago`}</Field>}
      {pr.jira && (
        <Field label="Jira">
          <JiraValue pr={pr} />
        </Field>
      )}
      {pr.lastChecked && <Field label="Last checked">{pr.lastChecked} (UTC)</Field>}
    </dl>
  )
}

function ChecksSection({ ci, behind }: { ci: ReturnType<typeof parseCi>; behind: ReturnType<typeof parseBehind> }) {
  if (!ci && !behind) return null
  return (
    <Section title="Checks">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {ci && <ToneChip tone={ci.tone}>CI: {ci.label}</ToneChip>}
        {behind && <ToneChip tone={behind.tone}>{behind.label}</ToneChip>}
      </div>
      {ci && ci.checks.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {ci.checks.map((check, i) => (
            <li key={i}>
              <CheckLine check={check} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// "Build (FAILURE)" → "❌ Build", with the state kept as the tooltip and accessible name.
function CheckLine({ check }: { check: string }) {
  const { name, state } = parseCheck(check)
  const mark = state ? stateEmoji(state) : null
  if (!state) return <>{name}</>
  if (!mark) return <>{name} ({state})</>
  return (
    <span title={mark.label}>
      <span role="img" aria-label={mark.label}>
        {mark.emoji}
      </span>{" "}
      {name}
    </span>
  )
}

function StateLabel({ state, label }: { state: string; label: string }) {
  const mark = stateEmoji(state)
  if (!mark) return <>{label}</>
  return (
    <>
      <span aria-hidden="true">{mark.emoji}</span> {label}
    </>
  )
}

function ReviewsSection({ reviews, owners }: { reviews: string | null; owners: string | null }) {
  const entries = parseReviews(reviews)
  const pendingOwners = splitList(owners)
  if (entries.length === 0 && pendingOwners.length === 0) return null
  return (
    <Section title="Reviews">
      {entries.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {entries.map((r, i) => {
            const hint = reviewStateHint(r.state)
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{r.reviewer}</span>
                <ToneChip tone={hint.tone}>
                  <StateLabel state={r.state} label={hint.label} />
                </ToneChip>
              </li>
            )
          })}
        </ul>
      )}
      {pendingOwners.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Waiting on code owners</div>
          <div className="flex flex-wrap gap-1">
            {pendingOwners.map((o) => (
              <Pill key={o} className="text-[11px]">
                {o}
              </Pill>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

function CommentsSection({ value, url }: { value: string | null; url: string }) {
  const unresolved = parseUnresolved(value)
  if (!unresolved) return null
  return (
    <Section title="Unresolved comments">
      {unresolved.count === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <>
          <p className="mb-2 text-sm">
            <ToneChip tone="warn">{unresolved.count} unresolved</ToneChip>
          </p>
          <ul className="space-y-1.5 text-sm">
            {unresolved.snippets.map((s, i) => (
              <li key={i} className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed break-words">
                {s}
              </li>
            ))}
          </ul>
          {unresolved.more > 0 && (
            <a href={url} {...EXTERNAL_LINK} className="mt-2 inline-block text-xs text-primary hover:underline">
              +{unresolved.more} more on GitHub
            </a>
          )}
        </>
      )}
    </Section>
  )
}

function TasksSection({
  tasks,
  taskStatusByPath,
  onOpenTask,
}: {
  tasks: Note[]
  taskStatusByPath: Map<string, TaskStatus>
  onOpenTask: (path: string) => void
}) {
  if (tasks.length === 0) return null
  return (
    <Section title={tasks.length === 1 ? "Task" : "Tasks"}>
      <div className="space-y-2">
        {tasks.map((task) => {
          const status = taskStatusByPath.get(task.path)
          return (
            <button
              key={task.path}
              onClick={() => onOpenTask(task.path)}
              className="flex w-full items-center gap-2 rounded-lg border border-border p-2.5 text-left text-sm transition-colors hover:border-primary/50"
            >
              {status && <TaskStatusDot status={status} />}
              <span className="min-w-0 flex-1 font-medium">{task.title}</span>
              {status && <span className="shrink-0 text-[11px] text-muted-foreground">{status.label}</span>}
            </button>
          )
        })}
      </div>
    </Section>
  )
}

export function PrDetail({
  pr,
  tasks,
  taskStatusByPath,
  onOpenTask,
}: {
  pr: LedgerPr
  // Task files whose `prs:` frontmatter lists this PR.
  tasks: Note[]
  taskStatusByPath: Map<string, TaskStatus>
  onOpenTask: (path: string) => void
}) {
  const detail = pr.detail
  return (
    <article className="mx-auto max-w-2xl p-6 lg:p-10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {pr.state === "pending" && <ToneChip tone="warn">Pending</ToneChip>}
          {pr.state === "merged" && <ToneChip tone="good">Merged</ToneChip>}
          {pr.state === "closed" && <ToneChip tone="neutral">Closed</ToneChip>}
          {pr.jira && (
            <Pill className="text-[11px]">
              <JiraValue pr={pr} />
            </Pill>
          )}
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" asChild>
          <a href={pr.url} {...EXTERNAL_LINK}>
            <ExternalLink className="size-3.5" />
            Open on GitHub
          </a>
        </Button>
      </div>

      <h1 className="mb-1.5 text-lg font-semibold tracking-tight">{prTitle(pr)}</h1>
      <div className="mb-6 font-mono text-xs text-muted-foreground">
        <a href={pr.url} {...EXTERNAL_LINK} className="hover:text-primary hover:underline">
          {pr.repo}#{pr.number}
        </a>
      </div>

      <Section title="Overview">
        <Overview pr={pr} />
      </Section>

      {pr.state === "pending" && !detail && (
        <p className="mb-6 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          No detail row for this PR yet. Run <code className="font-mono">tools/check-prs.sh</code> to add its CI status,
          reviews and unresolved comments to <code className="font-mono">PRS.md</code>.
        </p>
      )}

      {detail && (
        <>
          <ChecksSection ci={parseCi(detail.ci)} behind={parseBehind(detail.behindMain)} />
          <ReviewsSection reviews={detail.reviews} owners={detail.pendingCodeOwners} />
          <CommentsSection value={detail.unresolvedComments} url={pr.url} />
        </>
      )}

      <TasksSection tasks={tasks} taskStatusByPath={taskStatusByPath} onOpenTask={onOpenTask} />
    </article>
  )
}
