// Shapes the parsed PR ledger for the Pull requests view: filtering and grouping for the list,
// task ↔ PR links, and turning check-prs.sh's free-text cells (CI, reviews, comments) into
// structured pieces the UI can render.

import type { Note } from "@/lib/notes-frontmatter"
import { prKeyFromRef, type LedgerPr, type PrState } from "@/lib/prs-parser"
import { isTaskFile } from "@/lib/task-status"

export type Tone = "good" | "bad" | "warn" | "neutral"

export interface Hint {
  label: string
  tone: Tone
}

export const PR_STATES: { state: PrState; label: string }[] = [
  { state: "pending", label: "Pending" },
  { state: "merged", label: "Merged" },
  { state: "closed", label: "Closed" },
]

export interface PrFilter {
  state: PrState
  repo: string | null
  dateFrom: string
  dateTo: string
  // The open PR never gets filtered out of its own list (same rule the notes list follows).
  keepKey: string | null
}

export function filterPrs(prs: LedgerPr[], { state, repo, dateFrom, dateTo, keepKey }: PrFilter): LedgerPr[] {
  return prs.filter((pr) => {
    if (pr.key === keepKey) return true
    if (pr.state !== state) return false
    if (repo && pr.repo !== repo) return false
    if (dateFrom || dateTo) {
      if (!pr.opened || (dateFrom && pr.opened < dateFrom) || (dateTo && pr.opened > dateTo)) return false
    }
    return true
  })
}

export function countByState(prs: LedgerPr[]): Record<PrState, number> {
  const counts: Record<PrState, number> = { pending: 0, merged: 0, closed: 0 }
  for (const pr of prs) counts[pr.state]++
  return counts
}

export function reposIn(prs: LedgerPr[]): string[] {
  return [...new Set(prs.map((p) => p.repo))].sort((a, b) => a.localeCompare(b))
}

export interface PrRepoGroup {
  repo: string
  prs: LedgerPr[]
}

// Assumes `prs` is sorted by repo (parsePrLedger) so each repo's PRs are contiguous.
export function groupPrsByRepo(prs: LedgerPr[]): PrRepoGroup[] {
  const groups: PrRepoGroup[] = []
  for (const pr of prs) {
    const current = groups[groups.length - 1]
    if (current && current.repo === pr.repo) current.prs.push(pr)
    else groups.push({ repo: pr.repo, prs: [pr] })
  }
  return groups
}

// PR key → the task files whose `prs:` frontmatter lists it.
export function tasksByPrKey(notes: Note[]): Map<string, Note[]> {
  const map = new Map<string, Note[]>()
  for (const note of notes) {
    if (!isTaskFile(note)) continue
    for (const ref of note.prs) {
      const key = prKeyFromRef(ref)
      if (!key) continue
      const list = map.get(key) ?? []
      if (!list.includes(note)) list.push(note)
      map.set(key, list)
    }
  }
  return map
}

export function prTitle(pr: LedgerPr): string {
  return pr.detail?.title ?? `${pr.repo}#${pr.number}`
}

// "🔴 Failing — A (FAILURE), B (FAILURE)" → a label, a tone, and the individual checks.
export function parseCi(ci: string | null): (Hint & { checks: string[] }) | null {
  if (!ci) return null
  const tone: Tone = ci.startsWith("🔴") ? "bad" : ci.startsWith("🟢") ? "good" : ci.startsWith("🟡") ? "warn" : "neutral"
  const text = ci.replace(/^\p{Extended_Pictographic}️?\s*/u, "")
  const [label, rest] = splitOnce(text, " — ")
  return { label, tone, checks: rest ? splitList(rest) : [] }
}

// "No" is up to date; "Yes" is behind; "Conflicts — dirty" has merge conflicts.
export function parseBehind(behind: string | null): Hint | null {
  if (!behind) return null
  const value = behind.trim()
  if (/^no$/i.test(value)) return { label: "Up to date with base", tone: "good" }
  if (/^yes$/i.test(value)) return { label: "Behind base", tone: "warn" }
  if (/^conflicts/i.test(value)) return { label: "Merge conflicts", tone: "bad" }
  return { label: value, tone: "neutral" }
}

export interface Review {
  reviewer: string
  state: string
}

// "alice (APPROVED), bot[bot] (CHANGES_REQUESTED)" → one entry per reviewer/state pair.
export function parseReviews(reviews: string | null): Review[] {
  if (!reviews) return []
  return [...reviews.matchAll(/\s*([^,()]+?)\s*\(([A-Z_]+)\)/g)].map((m) => ({ reviewer: m[1], state: m[2] }))
}

const REVIEW_STATE_LABELS: Record<string, Hint> = {
  APPROVED: { label: "Approved", tone: "good" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "bad" },
  COMMENTED: { label: "Commented", tone: "neutral" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
  PENDING: { label: "Pending", tone: "neutral" },
}

export function reviewStateHint(state: string): Hint {
  return REVIEW_STATE_LABELS[state] ?? { label: state.toLowerCase().replace(/_/g, " "), tone: "neutral" }
}

// One hint for the list row: changes requested beats approved beats "has comments".
export function reviewSummary(reviews: string | null): Hint | null {
  const states = new Set(parseReviews(reviews).map((r) => r.state))
  if (states.has("CHANGES_REQUESTED")) return REVIEW_STATE_LABELS.CHANGES_REQUESTED
  if (states.has("APPROVED")) return REVIEW_STATE_LABELS.APPROVED
  if (states.size > 0) return { label: "Reviewed", tone: "neutral" }
  return null
}

export interface UnresolvedComments {
  count: number
  snippets: string[]
  // "(+6 more)" at the end of the cell: snippets check-prs.sh left out.
  more: number
}

// "None" → 0; "3 unresolved: a: …; b: … (+1 more)" → count, snippets and the overflow.
export function parseUnresolved(value: string | null): UnresolvedComments | null {
  if (!value) return null
  if (/^none$/i.test(value.trim())) return { count: 0, snippets: [], more: 0 }
  const match = value.match(/^(\d+)\s+unresolved:?\s*([\s\S]*)$/i)
  if (!match) return { count: 1, snippets: [value], more: 0 }
  let rest = match[2].trim()
  let more = 0
  const overflow = rest.match(/\s*\(\+(\d+)\s+more\)\s*$/)
  if (overflow) {
    more = Number(overflow[1])
    rest = rest.slice(0, overflow.index).trim()
  }
  return { count: Number(match[1]), snippets: rest ? rest.split(/;\s+/).filter(Boolean) : [], more }
}

// "9d" → "9 days", "0d" → "today"; anything else unchanged.
export function formatAge(age: string | null): string | null {
  if (!age) return null
  const days = age.match(/^(\d+)d$/)
  if (!days) return age
  const n = Number(days[1])
  return n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`
}

export function splitList(value: string | null): string[] {
  return value ? value.split(/,\s*/).map((s) => s.trim()).filter(Boolean) : []
}

function splitOnce(text: string, separator: string): [string, string | null] {
  const i = text.indexOf(separator)
  return i < 0 ? [text.trim(), null] : [text.slice(0, i).trim(), text.slice(i + separator.length).trim()]
}
