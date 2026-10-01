// Recognizes references from one note to another, so the viewer can open them in place: markdown
// links to a .md file in the workspace ("../tasks/x.md", "notes/x.md") and [[wiki]] links naming a
// note by file name, with or without its date prefix and .md ending.

import type { Link, Root } from "mdast"
import { findAndReplace } from "mdast-util-find-and-replace"

import type { Note } from "@/lib/notes-frontmatter"

const WIKI_LINK = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/
const MARKDOWN_EXT = ".md"
// Marks a link made from [[...]], which shows as plain text when it names no note.
export const WIKI_LINK_ATTR = "data-wiki-link"

// remark plugin: [[slug]] and [[slug|label]] become links whose href is the slug.
export function remarkWikiLinks() {
  return (tree: Root) => {
    findAndReplace(tree, [
      WIKI_LINK,
      (_match: string, target: string, label: string | undefined): Link => ({
        type: "link",
        url: target.trim(),
        children: [{ type: "text", value: (label ?? target).trim() }],
        data: { hProperties: { [WIKI_LINK_ATTR]: "" } },
      }),
    ])
  }
}

function dirOf(path: string): string[] {
  return path.split("/").slice(0, -1)
}

// Resolves "./", "../" and plain segments against a base directory; null when it climbs out of the root.
function joinPath(base: string[], relative: string): string | null {
  const parts = [...base]
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join("/")
}

function fileStem(path: string): string {
  const name = path.split("/").pop() ?? path
  return name.endsWith(MARKDOWN_EXT) ? name.slice(0, -MARKDOWN_EXT.length) : name
}

export interface NoteLinkIndex {
  // The note an href written inside `fromPath` points at, or null when it isn't one.
  resolveHref: (href: string, fromPath: string) => Note | null
  resolveWiki: (target: string) => Note | null
}

export function buildNoteLinkIndex(notes: Note[]): NoteLinkIndex {
  const byPath = new Map(notes.map((n) => [n.path, n]))
  const byStem = new Map<string, Note>()
  for (const note of notes) {
    const stem = fileStem(note.path)
    byStem.set(stem, note)
    // The first note claims an undated slug; a later one with the same slug doesn't take it over.
    const undated = stem.replace(DATE_PREFIX, "")
    if (!byStem.has(undated)) byStem.set(undated, note)
  }

  function resolveHref(href: string, fromPath: string): Note | null {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null
    let target: string
    try {
      target = decodeURIComponent(href.split("#")[0].split("?")[0])
    } catch {
      return null
    }
    if (!target.endsWith(MARKDOWN_EXT)) return null
    // Relative to the linking note first; notes are also often linked by their path from the root.
    const candidates = [joinPath(dirOf(fromPath), target), joinPath([], target)]
    for (const path of candidates) {
      const note = path === null ? undefined : byPath.get(path)
      if (note) return note
    }
    return null
  }

  function resolveWiki(target: string): Note | null {
    return byStem.get(fileStem(target.trim())) ?? null
  }

  return { resolveHref, resolveWiki }
}
