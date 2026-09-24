// Reads the notes repo's notes/plans/daily/tasks frontmatter in the browser,
// using the same conventions the ainotes-* skills write.

export type NoteSource = "notes" | "plans" | "daily" | "tasks"

export interface Note {
  path: string
  source: NoteSource
  title: string
  excerpt: string
  date: string | null
  type: string | null
  repo: string | null
  domain: string[]
  epic: string | null
  jira: string | null
  tags: string[]
  status: string | null
  mtime: number
  body: string
  // The original "---\n...\n---\n" block, byte-for-byte. Saving an edited
  // body reuses this verbatim rather than re-serializing frontmatter from
  // the parsed object, so field order, quoting, and formatting the author
  // (or the ainotes-notes skill) chose are never altered by an edit.
  rawFrontmatter: string
}

// YAML treats " #..." after an unquoted value as a comment (e.g. `status: open   # open -> done`).
function stripInlineComment(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return value
  return value.replace(/(^|\s)#.*$/, "")
}

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string; rawFrontmatter: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: {}, body: raw, rawFrontmatter: "" }

  const lines = match[1].split(/\r?\n/)
  const fm: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) {
      i++
      continue
    }
    const key = kv[1]
    const rest = stripInlineComment(kv[2]).trim()
    if (rest === "") {
      const list: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s*-\s*/.test(lines[j])) {
        list.push(lines[j].replace(/^\s*-\s*/, "").trim())
        j++
      }
      fm[key] = list
      i = j
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim()
      fm[key] = inner === "" ? [] : inner.split(",").map((s) => s.trim())
      i++
    } else {
      fm[key] = rest === "null" ? null : rest.replace(/^"(.*)"$/, "$1")
      i++
    }
  }
  const body = raw.slice(match[0].length)
  return { frontmatter: fm, body, rawFrontmatter: match[0] }
}

export function extractTitle(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : null
}

export function extractExcerpt(body: string): string {
  const withoutHeading = body.replace(/^#\s+.+$/m, "")
  const lines = withoutHeading.split(/\r?\n/).map((l) => l.trim())
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("- [")) continue
    return line.length > 200 ? line.slice(0, 200) + "…" : line
  }
  return ""
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

export function toNote(relPath: string, source: NoteSource, raw: string, mtime: number): Note {
  const { frontmatter, body, rawFrontmatter } = parseFrontmatter(raw)
  return {
    path: relPath,
    source,
    // Tasks (ainotes-tasks) carry an explicit frontmatter title instead of a body heading.
    title: asStringOrNull(frontmatter.title) || extractTitle(body) || relPath,
    excerpt: extractExcerpt(body),
    // Tasks use `created` instead of `date`.
    date: asStringOrNull(frontmatter.date) ?? asStringOrNull(frontmatter.created),
    type: asStringOrNull(frontmatter.type),
    repo: asStringOrNull(frontmatter.repo),
    domain: asStringArray(frontmatter.domain),
    epic: asStringOrNull(frontmatter.epic),
    jira: asStringOrNull(frontmatter.jira),
    tags: asStringArray(frontmatter.tags),
    status: asStringOrNull(frontmatter.status),
    mtime,
    body,
    rawFrontmatter,
  }
}

// Rewrites just the `tags:` entry inside a raw frontmatter block, leaving every
// other field (order, quoting, unrelated bracketed fields like `links:`)
// untouched. Matches ainotes-notes' two possible list shapes: inline "[a, b]"
// (what every real note currently uses) and a multi-line "- item" block,
// preserving whichever shape was already there. A note with no tags field
// yet gets one appended, inline, just before the closing "---".
const INLINE_TAGS_RE = /^tags:\s*\[([^\]]*)\]\s*$/m
const MULTILINE_TAGS_RE = /^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]*.*\r?\n)+)/m

export function withUpdatedTags(rawFrontmatter: string, tags: string[]): string {
  const inlineValue = `tags: [${tags.join(", ")}]`

  if (INLINE_TAGS_RE.test(rawFrontmatter)) {
    return rawFrontmatter.replace(INLINE_TAGS_RE, inlineValue)
  }

  const multilineMatch = rawFrontmatter.match(MULTILINE_TAGS_RE)
  if (multilineMatch) {
    const firstItemLine = multilineMatch[1].split(/\r?\n/)[0] ?? ""
    const indent = firstItemLine.match(/^([ \t]*)-/)?.[1] ?? "  "
    const block = tags.length > 0 ? `tags:\n${tags.map((t) => `${indent}- ${t}`).join("\n")}\n` : "tags: []\n"
    return rawFrontmatter.replace(MULTILINE_TAGS_RE, block)
  }

  return rawFrontmatter.replace(/\r?\n---\r?\n?$/, `\n${inlineValue}\n---\n`)
}

// Rewrites just the value of the `status:` entry, keeping any trailing comment and every other
// byte of the frontmatter. A frontmatter with no status field gets one appended before "---".
const STATUS_LINE_RE = /^(status:[ \t]*)([^#\r\n]*?)([ \t]*(?:#[^\r\n]*)?)$/m

export function withUpdatedStatus(rawFrontmatter: string, status: string): string {
  if (STATUS_LINE_RE.test(rawFrontmatter)) {
    return rawFrontmatter.replace(STATUS_LINE_RE, (_m, prefix: string, _old: string, suffix: string) => {
      // "status:" with nothing after it needs a separating space before the new value.
      return `${prefix}${prefix.endsWith(":") ? " " : ""}${status}${suffix}`
    })
  }
  return rawFrontmatter.replace(/\r?\n---\r?\n?$/, `\nstatus: ${status}\n---\n`)
}

// Appends "- <line>" as the last entry of the body's "## Updates" section, if it has one;
// otherwise returns the body unchanged.
const UPDATES_HEADING_RE = /^##[ \t]+Updates[ \t]*$/m
const NEXT_HEADING_RE = /^#{1,2}[ \t]/m

export function withAppendedUpdate(body: string, line: string): string {
  const heading = UPDATES_HEADING_RE.exec(body)
  if (!heading) return body
  const eol = body.includes("\r\n") ? "\r\n" : "\n"
  const sectionStart = heading.index + heading[0].length
  const nextHeading = NEXT_HEADING_RE.exec(body.slice(sectionStart))
  const sectionEnd = nextHeading ? sectionStart + nextHeading.index : body.length
  const section = body.slice(sectionStart, sectionEnd)
  const content = section.replace(/\s+$/, "")
  const trailing = section.slice(content.length)
  // Keep the whitespace that separated this section from whatever followed it.
  const after = trailing.includes("\n") ? trailing : eol + trailing
  return body.slice(0, sectionStart) + content + eol + `- ${line}` + after + body.slice(sectionEnd)
}

export function localIsoDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const ad = a.date || ""
    const bd = b.date || ""
    if (ad !== bd) return ad < bd ? 1 : -1
    return b.mtime - a.mtime
  })
}

// ainotes-notes tags an epic as "epic:PROJ-100" so it sorts/filters distinctly from
// plain tags — the "epic:" half is bookkeeping, not something worth showing.
const EPIC_TAG_RE = /^epic:/i

export function displayTag(tag: string): string {
  return tag.replace(EPIC_TAG_RE, "")
}

// A plan's lifecycle: "planned" until it's executed or abandoned, then "done"
// (executed) or "dropped" (abandoned without executing) — shown as the more
// familiar open/closed/dropped vocabulary. A task (ainotes-tasks) uses "open"/"done"
// directly, and maps onto the same Open/Closed labels. `n/a` (used by
// notes/daily logs, which don't have a lifecycle) is hidden rather than relabeled.
const STATUS_LABELS: Record<string, string> = {
  planned: "Open",
  open: "Open",
  done: "Closed",
  dropped: "Dropped",
}

export function displayStatus(status: string | null): string | null {
  if (!status || status.toLowerCase() === "n/a") return null
  return STATUS_LABELS[status.toLowerCase()] ?? status
}

// Every distinct raw tag value in use, for autocomplete when adding a tag to a note.
// Raw, not display-transformed: picking a suggestion should reproduce the exact
// existing tag (e.g. "epic:PROJ-100"), not a stripped variant that reads as a new tag.
export function uniqueTags(notes: Note[]): string[] {
  const seen = new Set<string>()
  for (const n of notes) for (const t of n.tags) seen.add(t)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export interface NoteDateGroup {
  date: string | null
  notes: Note[]
}

// Assumes `notes` is already sorted by date (sortNotes) so equal-date runs are contiguous.
export function groupNotesByDate(notes: Note[]): NoteDateGroup[] {
  const groups: NoteDateGroup[] = []
  for (const note of notes) {
    const current = groups[groups.length - 1]
    if (current && current.date === note.date) {
      current.notes.push(note)
    } else {
      groups.push({ date: note.date, notes: [note] })
    }
  }
  return groups
}

export function formatDateHeading(date: string | null): string {
  if (!date) return "No date"
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
}
