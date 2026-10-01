// Where a task created with "Add task" came from: the note, plan or daily plan it was open on, a
// PR from the ledger, or an agent from the snapshot. Turned into the task file's references the
// way ainotes-tasks keeps them: `links:` for related notes/plans (paths relative to the repo root),
// `prs:` for PRs ("org/repo#123"), and the context itself under "## Purpose".

import { agentLocation, agentName, type Agent } from "@/lib/agents"
import type { Note } from "@/lib/notes-frontmatter"
import { prTitle } from "@/lib/pr-view"
import type { LedgerPr } from "@/lib/prs-parser"

export type TaskOrigin = { kind: "note"; note: Note } | { kind: "pr"; pr: LedgerPr } | { kind: "agent"; agent: Agent }

// A PR the task references: `ref` goes into `prs:`, `url` into TASKS.md's PRs cell.
export interface TaskPrRef {
  ref: string
  url: string
}

const NOTE_KIND_LABEL: Record<Note["source"], string> = {
  notes: "note",
  plans: "plan",
  daily: "daily plan",
  tasks: "task",
}

function prRef(pr: LedgerPr): string {
  return pr.org ? `${pr.org}/${pr.repo}#${pr.number}` : `${pr.repo}#${pr.number}`
}

// "https://github.com/acme/api/pull/12" → "acme/api#12".
function prRefFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  return m ? `${m[1]}/${m[2]}#${m[3]}` : null
}

// Shown in the dialog: what the new task will point back to.
export function describeTaskOrigin(origin: TaskOrigin): string {
  switch (origin.kind) {
    case "note":
      return `the ${NOTE_KIND_LABEL[origin.note.source]} "${origin.note.title}"`
    case "pr":
      return `PR ${prRef(origin.pr)}`
    case "agent":
      return `the agent "${agentName(origin.agent)}"`
  }
}

export function taskOriginLinks(origin: TaskOrigin): string[] {
  return origin.kind === "note" ? [origin.note.path] : []
}

export function taskOriginPrs(origin: TaskOrigin): TaskPrRef[] {
  switch (origin.kind) {
    case "note":
      return []
    case "pr":
      return [{ ref: prRef(origin.pr), url: origin.pr.url }]
    case "agent":
      return origin.agent.links
        .filter((l) => l.kind === "pr")
        .flatMap((l) => {
          const ref = prRefFromUrl(l.href)
          return ref ? [{ ref, url: l.href }] : []
        })
  }
}

// A note's own tags carry over as the task's starting tags; PRs and agents have none to offer.
export function taskOriginTags(origin: TaskOrigin): string[] {
  return origin.kind === "note" ? origin.note.tags.filter((t) => t !== "daily-plan") : []
}

// The "## Purpose" paragraph: where the task came from, with enough detail to find it again.
export function taskOriginPurpose(origin: TaskOrigin): string {
  switch (origin.kind) {
    case "note": {
      const { note } = origin
      const when = note.date ? ` (${note.date})` : ""
      return `Created from the ${NOTE_KIND_LABEL[note.source]} "${note.title}"${when}: \`${note.path}\`.`
    }
    case "pr": {
      const { pr } = origin
      const facts = [
        `state: ${pr.state}`,
        pr.opened && `opened ${pr.opened}`,
        pr.resolved && `${pr.state === "merged" ? "merged" : "closed"} ${pr.resolved}`,
        pr.jira && `Jira ${pr.jira}`,
      ].filter(Boolean)
      return `Created from PR [${prRef(pr)}](${pr.url}): ${prTitle(pr)} (${facts.join(", ")}).`
    }
    case "agent": {
      const { agent } = origin
      const facts = [
        `${agent.kind === "bg" ? "background job" : "interactive session"} ${agent.id}`,
        agentLocation(agent),
        agent.state && `state: ${agent.state}`,
        agent.updatedAt && `last update ${agent.updatedAt}`,
      ].filter(Boolean)
      const lines = [`Created from the agent "${agentName(agent)}" (${facts.join(", ")}).`]
      if (agent.detail) lines.push("", `Its last status: "${agent.detail}"`)
      return lines.join("\n")
    }
  }
}
