// Keeps INDEX.md (the tag → files map ainotes-notes maintains) in step with files the viewer
// creates or deletes. Same append-only convention as the skills: a new path goes at the end of its
// "## <tag>" section (the section is appended when missing), nothing else is rewritten, and
// fenced code blocks (the template's format example) are never touched.

export const INDEX_FILE = "INDEX.md"

// What a notes repo's INDEX.md starts as (templates/notes-repo/INDEX.md, minus the format example).
export const EMPTY_INDEX = `# Index

Tag → files map. Append the relevant tag section whenever a note or plan is added; never regenerate
this file from scratch. See the \`ainotes-notes\` skill for the full workflow.
`

const FENCE_RE = /^\s*(```|~~~)/
const SECTION_HEADING_RE = /^##[ \t]+(.+?)[ \t]*$/
const ANY_HEADING_RE = /^#{1,2}[ \t]/

interface IndexLine {
  text: string
  inFence: boolean
}

function toLines(markdown: string): { lines: IndexLine[]; eol: string } {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n"
  let inFence = false
  const lines = markdown.split(/\r?\n/).map((text) => {
    const fence = FENCE_RE.test(text)
    const line = { text, inFence: inFence || fence }
    if (fence) inFence = !inFence
    return line
  })
  return { lines, eol }
}

function fromLines(lines: IndexLine[], eol: string): string {
  return lines.map((l) => l.text).join(eol)
}

function entryLine(path: string): string {
  return `- ${path}`
}

function isEntryFor(line: IndexLine, path: string): boolean {
  return !line.inFence && line.text.trim() === entryLine(path)
}

// [heading index, index after the section's last line)
function findSection(lines: IndexLine[], tag: string): [number, number] | null {
  const start = lines.findIndex((l) => !l.inFence && SECTION_HEADING_RE.exec(l.text)?.[1] === tag)
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && (lines[end].inFence || !ANY_HEADING_RE.test(lines[end].text))) end++
  return [start, end]
}

function lastContentLine(lines: IndexLine[], from: number, to: number): number {
  let last = from
  for (let i = from + 1; i < to; i++) if (lines[i].text.trim()) last = i
  return last
}

export function addToIndex(markdown: string, path: string, tags: string[]): string {
  const { lines, eol } = toLines(markdown)
  for (const tag of new Set(tags)) {
    const section = findSection(lines, tag)
    if (section) {
      const [start, end] = section
      if (lines.slice(start, end).some((l) => isEntryFor(l, path))) continue
      lines.splice(lastContentLine(lines, start, end) + 1, 0, { text: entryLine(path), inFence: false })
      continue
    }
    while (lines.length > 0 && !lines[lines.length - 1].text.trim()) lines.pop()
    lines.push({ text: "", inFence: false }, { text: `## ${tag}`, inFence: false }, { text: entryLine(path), inFence: false })
  }
  if (lines[lines.length - 1]?.text !== "") lines.push({ text: "", inFence: false })
  return fromLines(lines, eol)
}

// Drops every entry for `path`, and any section heading left with no entries at all.
export function removeFromIndex(markdown: string, path: string): string {
  const { lines, eol } = toLines(markdown)
  const kept = lines.filter((l) => !isEntryFor(l, path))
  if (kept.length === lines.length) return markdown
  const result: IndexLine[] = []
  for (let i = 0; i < kept.length; i++) {
    const heading = !kept[i].inFence && SECTION_HEADING_RE.test(kept[i].text)
    if (heading) {
      let end = i + 1
      while (end < kept.length && (kept[end].inFence || !ANY_HEADING_RE.test(kept[end].text))) end++
      const empty = kept.slice(i + 1, end).every((l) => !l.text.trim())
      if (empty) {
        // Skip the heading and its blank lines; the blank line before it still separates what's around it.
        i = end - 1
        continue
      }
    }
    result.push(kept[i])
  }
  return fromLines(result, eol)
}
