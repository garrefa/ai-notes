// Parses the notes repo's PRS.md (maintained by the ainotes-pr-tracker skill
// and tools/check-prs.sh) into structured PR entries. Deliberately narrow — it only
// understands the exact table shapes those write, not markdown tables
// in general.

export type PrState = "pending" | "merged" | "closed"

// The "Pending — Detail" row check-prs.sh generates for an open PR. Every field is the cell's
// text as written; a missing or "—" cell is null.
export interface PrDetail {
  title: string | null
  openFor: string | null
  lastCommit: string | null
  ci: string | null
  behindMain: string | null
  reviews: string | null
  pendingCodeOwners: string | null
  unresolvedComments: string | null
}

export interface LedgerPr {
  // "<repo>#<number>", lowercased: the identity shared by the ledger tables and tasks' `prs:`.
  key: string
  state: PrState
  number: string
  url: string
  org: string
  repo: string
  opened: string | null
  // The day it merged or was closed (Merged / Closed tables only).
  resolved: string | null
  jira: string | null
  // Set only when the ledger's Jira cell is a markdown link.
  jiraUrl: string | null
  lastChecked: string | null
  // Pending PRs only, and only when the Detail table has a row for it.
  detail: PrDetail | null
}

export interface PrLedger {
  prs: LedgerPr[]
  // The date on the Detail table's "_Last deep check: YYYY-MM-DD ..._" line.
  lastDeepCheck: string | null
}

const PR_LINK_RE = /\[#(\d+)\]\(([^)]+)\)/
const MD_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/
const DEEP_CHECK_RE = /Last deep check:\s*(\d{4}-\d{2}-\d{2})/

const STATE_SECTIONS: { state: PrState; heading: string; resolvedColumn: string | null }[] = [
  { state: "pending", heading: "Pending (open)", resolvedColumn: null },
  { state: "merged", heading: "Merged", resolvedColumn: "Merged" },
  { state: "closed", heading: "Closed (not merged)", resolvedColumn: "Closed" },
]
const DETAIL_HEADING = "Pending — Detail"

// Cells are separated by "|"; check-prs.sh escapes a literal pipe inside a cell as "\|".
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/.test(c))
}

// Returns the raw text of a "## <heading>" section, up to the next "## " or EOF.
function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const startIndex = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (startIndex < 0) return null
  const rest = lines.slice(startIndex + 1)
  const endIndex = rest.findIndex((l) => /^##\s/.test(l))
  return (endIndex < 0 ? rest : rest.slice(0, endIndex)).join("\n")
}

interface Table {
  headers: string[]
  rows: string[][]
}

function parseTable(sectionText: string): Table | null {
  const lines = sectionText.split(/\r?\n/).filter(isTableRow)
  if (lines.length < 2) return null
  const headers = splitRow(lines[0])
  const bodyRows = lines.slice(1).filter((l) => !isSeparatorRow(splitRow(l)))
  return { headers, rows: bodyRows.map(splitRow) }
}

function cell(table: Table, row: string[], name: string): string | null {
  const i = table.headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  if (i < 0) return null
  const value = row[i]?.trim()
  return !value || value === "—" || value === "-" ? null : value
}

// ".../<org>/<repo>/pull/<n>" → { org, repo }. The Detail table has no Repo column, so the URL is
// the only source every table shares.
function repoFromUrl(url: string): { org: string; repo: string } {
  const segments = url.split("/")
  const pullIndex = segments.lastIndexOf("pull")
  return pullIndex > 1 ? { org: segments[pullIndex - 2], repo: segments[pullIndex - 1] } : { org: "", repo: "" }
}

export function prKey(repo: string, number: string | number): string {
  return `${repo}#${number}`.toLowerCase()
}

// A task's `prs:` entry ("org/repo#123", "repo#123", or a PR URL) → the same key, or null.
export function prKeyFromRef(ref: string): string | null {
  const value = ref.trim().replace(/^["']|["']$/g, "")
  const url = value.match(/\/([^/]+)\/pull\/(\d+)/)
  if (url) return prKey(url[1], url[2])
  const short = value.match(/^(?:[^/\s#]+\/)?([^/\s#]+)#(\d+)$/)
  return short ? prKey(short[1], short[2]) : null
}

function tableRowsOf(markdown: string, heading: string): Table | null {
  const section = extractSection(markdown, heading)
  return section ? parseTable(section) : null
}

function parseDetails(markdown: string): Map<string, PrDetail> {
  const table = tableRowsOf(markdown, DETAIL_HEADING)
  const byKey = new Map<string, PrDetail>()
  if (!table) return byKey
  for (const row of table.rows) {
    const match = cell(table, row, "PR")?.match(PR_LINK_RE)
    if (!match) continue
    byKey.set(prKey(repoFromUrl(match[2]).repo, match[1]), {
      title: cell(table, row, "Title"),
      openFor: cell(table, row, "Open for"),
      lastCommit: cell(table, row, "Last commit"),
      ci: cell(table, row, "CI"),
      behindMain: cell(table, row, "Behind main?"),
      reviews: cell(table, row, "Reviews"),
      pendingCodeOwners: cell(table, row, "Pending code owners"),
      unresolvedComments: cell(table, row, "Unresolved comments"),
    })
  }
  return byKey
}

function parseJira(value: string | null): { jira: string | null; jiraUrl: string | null } {
  if (!value) return { jira: null, jiraUrl: null }
  const link = value.match(MD_LINK_RE)
  return link ? { jira: link[1], jiraUrl: link[2] } : { jira: value, jiraUrl: null }
}

// Every PR in the ledger, pending ones merged with their Detail row (keyed by repo + number, so
// two repos' PRs with the same number never collide). Sorted by repo, then PR number. A PR listed
// twice (e.g. mid-edit, in both Pending and Merged) is kept once, preferring its resolved state.
export function parsePrLedger(markdown: string): PrLedger {
  const details = parseDetails(markdown)
  const byKey = new Map<string, LedgerPr>()

  for (const { state, heading, resolvedColumn } of STATE_SECTIONS) {
    const table = tableRowsOf(markdown, heading)
    if (!table) continue
    for (const row of table.rows) {
      const match = cell(table, row, "PR")?.match(PR_LINK_RE)
      if (!match) continue
      const [, number, url] = match
      const fromUrl = repoFromUrl(url)
      const repo = cell(table, row, "Repo") ?? fromUrl.repo
      const key = prKey(fromUrl.repo || repo, number)
      const existing = byKey.get(key)
      if (existing && existing.state !== "pending") continue
      byKey.set(key, {
        key,
        state,
        number,
        url,
        org: fromUrl.org,
        repo,
        opened: cell(table, row, "Opened"),
        resolved: resolvedColumn ? cell(table, row, resolvedColumn) : null,
        ...parseJira(cell(table, row, "Jira")),
        lastChecked: cell(table, row, "Last checked (UTC)"),
        detail: state === "pending" ? (details.get(key) ?? null) : null,
      })
    }
  }

  const prs = [...byKey.values()].sort((a, b) => a.repo.localeCompare(b.repo) || Number(a.number) - Number(b.number))
  const deepCheck = extractSection(markdown, DETAIL_HEADING)?.match(DEEP_CHECK_RE)
  return { prs, lastDeepCheck: deepCheck ? deepCheck[1] : null }
}
