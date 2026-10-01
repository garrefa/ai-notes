// Builds the files the viewer's "New" dialog creates, in the same shape the ainotes-* skills write
// them (see skills/ainotes-notes, ainotes-daily-plan and ainotes-tasks): the frontmatter fields,
// the file name (YYYY-MM-DD-slug.md, or YYYY-MM-DD.md for a daily plan), and a starter body.

import { yamlScalar, type NoteSource } from "@/lib/notes-frontmatter"
import { taskOriginLinks, taskOriginPrs, taskOriginPurpose, type TaskOrigin } from "@/lib/task-origin"
import type { TaskStatus } from "@/lib/task-status"

export type EntryKind = "note" | "plan" | "daily" | "task"

export const ENTRY_KINDS: { kind: EntryKind; label: string; source: NoteSource }[] = [
  { kind: "note", label: "Note", source: "notes" },
  { kind: "plan", label: "Plan", source: "plans" },
  { kind: "daily", label: "Daily plan", source: "daily" },
  { kind: "task", label: "Task", source: "tasks" },
]

// The tag every entry of a kind is indexed under, on top of the user's own tags.
const KIND_TAGS: Record<EntryKind, string[]> = { note: [], plan: [], daily: ["daily-plan"], task: ["task"] }

// Notes and plans are only findable through their tags (INDEX.md), so they need at least one.
export function kindNeedsTag(kind: EntryKind): boolean {
  return KIND_TAGS[kind].length === 0
}

export function kindNeedsTitle(kind: EntryKind): boolean {
  return kind !== "daily"
}

export function sourceOfKind(kind: EntryKind): NoteSource {
  return ENTRY_KINDS.find((k) => k.kind === kind)!.source
}

export interface NewEntryInput {
  kind: EntryKind
  title: string
  // YYYY-MM-DD: the note's `date:` (a task's `created:`), and the file name's prefix.
  date: string
  tags: string[]
  // Tasks only.
  deadline: string | null
  status: Pick<TaskStatus, "key" | "label">
  // Tasks only: the item "Add task" was pressed on, referenced from the new task.
  origin?: TaskOrigin | null
}

export interface NewEntry {
  source: NoteSource
  // The file name without the directory. `fileName(n)` gives the n-th alternative (n ≥ 2) when
  // the first one is taken; a daily plan has only one possible name.
  fileName: (attempt: number) => string | null
  content: string
  tags: string[]
}

const MAX_SLUG_LENGTH = 60

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "") || "untitled"
}

// "a, b c" → ["a", "b-c"]: tags are single tokens; brackets and commas would break the inline list.
export function parseTagInput(text: string): string[] {
  const tags = text
    .split(",")
    .map((t) => t.trim().replace(/[[\]]/g, "").replace(/\s+/g, "-"))
    .filter(Boolean)
  return [...new Set(tags)]
}

function inlineList(values: string[]): string {
  return `[${values.join(", ")}]`
}

// Quoted: PR refs carry a "#", which would otherwise read as a YAML comment after a space.
function quotedList(values: string[]): string {
  return inlineList(values.map((v) => JSON.stringify(v)))
}

function frontmatter(fields: [string, string][]): string {
  return `---\n${fields.map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`
}

function buildContent({ kind, title, date, deadline, status, origin }: NewEntryInput, tags: string[], today: string): string {
  switch (kind) {
    case "note":
    case "plan":
      return (
        frontmatter([
          ["date", date],
          ["type", kind],
          ["repo", "null"],
          ["domain", "[]"],
          ["epic", "null"],
          ["tags", inlineList(tags)],
          ...(kind === "plan" ? ([["jira", "null"], ["worktree", "null"]] as [string, string][]) : []),
          ["status", kind === "plan" ? "planned" : "n/a"],
          ["links", "[]"],
        ]) + `\n# ${title}\n\n`
      )
    case "daily":
      return (
        frontmatter([
          ["date", date],
          ["type", "daily-plan"],
          ["domain", "[]"],
          ["epic", "null"],
          ["tags", inlineList(tags)],
          ["status", "open"],
          ["links", "[]"],
        ]) + `\n# Daily plan: ${date}\n\n- [ ] \n`
      )
    case "task":
      return (
        frontmatter([
          ["title", yamlScalar(title)],
          ["created", date],
          ["deadline", deadline ?? "null"],
          ["status", status.key],
          ["domain", "[]"],
          ["jira", "[]"],
          ["prs", origin ? quotedList(taskOriginPrs(origin).map((p) => p.ref)) : "[]"],
          ["tags", inlineList(tags)],
          ["links", origin ? quotedList(taskOriginLinks(origin)) : "[]"],
        ]) + `\n## Purpose\n${origin ? `${taskOriginPurpose(origin)}\n` : ""}\n\n## Updates\n- ${today}: created (${status.label})\n`
      )
  }
}

export function buildNewEntry(input: NewEntryInput, today: string): NewEntry {
  const tags = [...new Set([...KIND_TAGS[input.kind], ...input.tags])]
  const base = input.kind === "daily" ? input.date : `${input.date}-${slugify(input.title)}`
  return {
    source: sourceOfKind(input.kind),
    fileName: (attempt) => (attempt === 1 ? `${base}.md` : input.kind === "daily" ? null : `${base}-${attempt}.md`),
    content: buildContent(input, tags, today),
    tags,
  }
}
