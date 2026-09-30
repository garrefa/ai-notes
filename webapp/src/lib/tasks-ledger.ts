// Updates a task's row in the TASKS.md ledger (maintained by the ainotes-tasks skill):
//   Open:      | Task | Status | Created | Deadline | Jira | PRs | File |
//   Completed: | Task | Status | Created | Completed | Deadline | Jira | PRs | File |
// Rows are matched by their File link (tasks/<file>.md). Everything outside the touched
// row(s) is left byte-for-byte as it was.

const STATUS_COLUMN = "Status"
const COMPLETED_COLUMN = "Completed"
const SEPARATOR_ROW_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

interface LedgerTable {
  headers: string[]
  // Index (into the line array) of the header row, and of the first/after-last data row.
  headerLine: number
  firstRow: number
  endRow: number
  completed: boolean
}

export interface LedgerUpdateResult {
  markdown: string
  // Why the ledger couldn't be updated (row or table missing), or null on success.
  problem: string | null
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return inner.split(/(?<!\\)\|/).map((c) => c.trim())
}

function joinRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|")
}

function findTables(lines: string[]): LedgerTable[] {
  const tables: LedgerTable[] = []
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isTableLine(lines[i]) || !SEPARATOR_ROW_RE.test(lines[i + 1].trim())) continue
    const headers = splitRow(lines[i])
    let end = i + 2
    while (end < lines.length && isTableLine(lines[end])) end++
    tables.push({ headers, headerLine: i, firstRow: i + 2, endRow: end, completed: headers.includes(COMPLETED_COLUMN) })
    i = end - 1
  }
  return tables
}

function findRow(lines: string[], tables: LedgerTable[], taskPath: string) {
  for (const table of tables) {
    for (let i = table.firstRow; i < table.endRow; i++) {
      if (lines[i].includes(taskPath)) return { table, line: i }
    }
  }
  return null
}

function setCell(headers: string[], cells: string[], column: string, value: string): string[] {
  const index = headers.indexOf(column)
  if (index < 0) return cells
  const next = [...cells]
  while (next.length < headers.length) next.push("")
  next[index] = value
  return next
}

// Re-lays a row's cells out under another table's headers, matching columns by name.
function remapRow(fromHeaders: string[], cells: string[], toHeaders: string[]): string[] {
  const byName = new Map(fromHeaders.map((h, i) => [h, cells[i] ?? ""]))
  return toHeaders.map((h) => byName.get(h) ?? "")
}

// What ainotes-tasks creates when TASKS.md doesn't exist yet.
export const EMPTY_TASKS_LEDGER = `# Task Tracker

## Open
| Task | Status | Created | Deadline | Jira | PRs | File |
|---|---|---|---|---|---|---|

## Completed
| Task | Status | Created | Completed | Deadline | Jira | PRs | File |
|---|---|---|---|---|---|---|---|
`

// The ledger's placeholder for an empty Deadline/Jira/PRs cell.
export const EMPTY_CELL = "—"

// A pipe inside a cell would split it into two columns.
export function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|")
}

export function taskFileLink(taskPath: string): string {
  return `[${taskPath}](${taskPath})`
}

// Appends a row (cells by column name; missing columns stay empty) to the Open or Completed table.
export function appendLedgerRow(markdown: string, cellsByColumn: Record<string, string>, closed: boolean): LedgerUpdateResult {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n"
  const lines = markdown.split(/\r?\n/)
  const target = findTables(lines).find((t) => t.completed === closed)
  if (!target) return { markdown, problem: `TASKS.md has no ${closed ? "Completed" : "Open"} table.` }
  lines.splice(target.endRow, 0, joinRow(target.headers.map((h) => cellsByColumn[h] ?? "")))
  return { markdown: lines.join(eol), problem: null }
}

export function removeLedgerRow(markdown: string, taskPath: string): LedgerUpdateResult {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n"
  const lines = markdown.split(/\r?\n/)
  const found = findRow(lines, findTables(lines), taskPath)
  if (!found) return { markdown, problem: `No row for ${taskPath} in TASKS.md.` }
  lines.splice(found.line, 1)
  return { markdown: lines.join(eol), problem: null }
}

// Sets the given cells (by column name) on a task's row, wherever it sits.
export function updateLedgerCells(markdown: string, taskPath: string, cellsByColumn: Record<string, string>): LedgerUpdateResult {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n"
  const lines = markdown.split(/\r?\n/)
  const found = findRow(lines, findTables(lines), taskPath)
  if (!found) return { markdown, problem: `No row for ${taskPath} in TASKS.md.` }
  let cells = splitRow(lines[found.line])
  for (const [column, value] of Object.entries(cellsByColumn)) cells = setCell(found.table.headers, cells, column, value)
  lines[found.line] = joinRow(cells)
  return { markdown: lines.join(eol), problem: null }
}

export function updateLedgerStatus(
  markdown: string,
  taskPath: string,
  status: { key: string; closed: boolean },
  today: string,
): LedgerUpdateResult {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n"
  const lines = markdown.split(/\r?\n/)
  const tables = findTables(lines)
  const found = findRow(lines, tables, taskPath)
  if (!found) return { markdown, problem: `No row for ${taskPath} in TASKS.md.` }

  const cells = splitRow(lines[found.line])
  const target = found.table.completed === status.closed ? found.table : tables.find((t) => t.completed === status.closed)
  if (!target) {
    lines[found.line] = joinRow(setCell(found.table.headers, cells, STATUS_COLUMN, status.key))
    return {
      markdown: lines.join(eol),
      problem: `TASKS.md has no ${status.closed ? "Completed" : "Open"} table, so the row was updated in place.`,
    }
  }

  if (target === found.table) {
    lines[found.line] = joinRow(setCell(target.headers, cells, STATUS_COLUMN, status.key))
    return { markdown: lines.join(eol), problem: null }
  }

  let moved = remapRow(found.table.headers, cells, target.headers)
  moved = setCell(target.headers, moved, STATUS_COLUMN, status.key)
  moved = setCell(target.headers, moved, COMPLETED_COLUMN, status.closed ? today : "")

  // Insert at the end of the target table first, then remove the old row, adjusting for the shift.
  lines.splice(target.endRow, 0, joinRow(moved))
  lines.splice(found.line < target.endRow ? found.line : found.line + 1, 1)
  return { markdown: lines.join(eol), problem: null }
}
