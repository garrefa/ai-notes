// Parses the notes repo's PRS.md (maintained by the ainotes-pr-tracker skill
// and tools/check-prs.sh) into structured pending-PR entries. Deliberately narrow — it only
// understands the exact table shapes those write, not markdown tables
// in general.

export interface PendingPr {
  number: string
  url: string
  repo: string
  opened: string | null
  jira: string | null
  lastChecked: string | null
  title: string | null
  openFor: string | null
  lastCommit: string | null
  ci: string | null
  behindMain: string | null
  reviews: string | null
  pendingCodeOwners: string | null
  unresolvedComments: string | null
}

const PR_LINK_RE = /\[#(\d+)\]\(([^)]+)\)/

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((cell) => cell.trim())
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

function parseTable(sectionText: string): { headers: string[]; rows: string[][] } | null {
  const lines = sectionText.split(/\r?\n/).filter(isTableRow)
  if (lines.length < 2) return null
  const headers = splitRow(lines[0])
  const bodyRows = lines.slice(1).filter((l) => !isSeparatorRow(splitRow(l)))
  return { headers, rows: bodyRows.map(splitRow) }
}

// Keys a PR by "<repo>#<number>", taking the repo from the link URL
// (".../<org>/<repo>/pull/<n>") so two repos' PRs with the same number never
// collide. The Detail table has no Repo column, so the URL is the only source
// both tables share.
function prKey(url: string, number: string): string {
  const segments = url.split("/")
  const pullIndex = segments.lastIndexOf("pull")
  const repo = pullIndex > 0 ? segments[pullIndex - 1] : ""
  return `${repo}#${number}`
}

function cell(headers: string[], row: string[], name: string): string | null {
  const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  if (i < 0) return null
  const value = row[i]?.trim()
  return !value || value === "—" || value === "-" ? null : value
}

export function parsePrs(markdown: string): PendingPr[] {
  const pendingSection = extractSection(markdown, "Pending (open)")
  if (!pendingSection) return []
  const pendingTable = parseTable(pendingSection)
  if (!pendingTable) return []

  const detailSection = extractSection(markdown, "Pending — Detail")
  const detailTable = detailSection ? parseTable(detailSection) : null
  const detailByKey = new Map<string, string[]>()
  if (detailTable) {
    for (const row of detailTable.rows) {
      const prCell = cell(detailTable.headers, row, "PR")
      const match = prCell?.match(PR_LINK_RE)
      if (match) detailByKey.set(prKey(match[2], match[1]), row)
    }
  }

  const results: PendingPr[] = []
  for (const row of pendingTable.rows) {
    const prCell = cell(pendingTable.headers, row, "PR")
    const match = prCell?.match(PR_LINK_RE)
    if (!match) continue
    const [, number, url] = match

    const detailRow = detailTable ? detailByKey.get(prKey(url, number)) : undefined
    const detailHeaders = detailTable?.headers ?? []

    results.push({
      number,
      url,
      repo: cell(pendingTable.headers, row, "Repo") ?? "",
      opened: cell(pendingTable.headers, row, "Opened"),
      jira: cell(pendingTable.headers, row, "Jira"),
      lastChecked: cell(pendingTable.headers, row, "Last checked (UTC)"),
      title: detailRow ? cell(detailHeaders, detailRow, "Title") : null,
      openFor: detailRow ? cell(detailHeaders, detailRow, "Open for") : null,
      lastCommit: detailRow ? cell(detailHeaders, detailRow, "Last commit") : null,
      ci: detailRow ? cell(detailHeaders, detailRow, "CI") : null,
      behindMain: detailRow ? cell(detailHeaders, detailRow, "Behind main?") : null,
      reviews: detailRow ? cell(detailHeaders, detailRow, "Reviews") : null,
      pendingCodeOwners: detailRow ? cell(detailHeaders, detailRow, "Pending code owners") : null,
      unresolvedComments: detailRow ? cell(detailHeaders, detailRow, "Unresolved comments") : null,
    })
  }
  return results.sort((a, b) => a.repo.localeCompare(b.repo) || Number(a.number) - Number(b.number))
}
