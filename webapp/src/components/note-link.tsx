import { createContext, useContext, type ComponentProps } from "react"
import type { ExtraProps } from "react-markdown"

import { WIKI_LINK_ATTR, type NoteLinkIndex } from "@/lib/note-links"
import type { Note } from "@/lib/notes-frontmatter"

export interface NoteLinks {
  index: NoteLinkIndex
  preview: (note: Note) => void
}

// Provided by NoteLinksProvider; without it, links to notes render as ordinary links.
export const NoteLinksContext = createContext<NoteLinks | null>(null)
// The note whose body is being rendered, which relative links are resolved against.
export const CurrentNotePathContext = createContext<string | null>(null)

function isExternal(href: string | undefined) {
  return !!href && /^https?:\/\//.test(href)
}

function useLinkedNote(href: string | undefined, isWiki: boolean): Note | null {
  const links = useContext(NoteLinksContext)
  const fromPath = useContext(CurrentNotePathContext)
  if (!links || !href) return null
  if (isWiki) return links.index.resolveWiki(href)
  return fromPath ? links.index.resolveHref(href, fromPath) : null
}

// Every link in a rendered note: one to another note opens it in the preview, a web link opens in a
// new tab, and a [[wiki]] link that names no note is left as its text.
export function NoteLink({ node: _node, href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  const links = useContext(NoteLinksContext)
  const isWiki = WIKI_LINK_ATTR in props
  const target = useLinkedNote(href, isWiki)

  if (target && links) {
    const preview = (e: React.MouseEvent) => {
      e.preventDefault()
      links.preview(target)
    }
    return (
      <a {...props} href={href} title={target.title} onClick={preview}>
        {children}
      </a>
    )
  }
  if (isWiki) return <span>{children}</span>
  const newTab = isExternal(href) ? { target: "_blank", rel: "noreferrer" } : {}
  return (
    <a {...props} href={href} {...newTab}>
      {children}
    </a>
  )
}
