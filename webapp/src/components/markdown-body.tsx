import type { Nodes, Root } from "mdast"
import Markdown, { type Components, type Options } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkEmoji from "remark-emoji"
import remarkGfm from "remark-gfm"
import { remarkAlert } from "remark-github-blockquote-alert"

import { CurrentNotePathContext, NoteLink } from "@/components/note-link"
import { remarkWikiLinks } from "@/lib/note-links"

import "@/markdown.css"

function isHtmlComment(node: Nodes): boolean {
  return node.type === "html" && node.value.trimStart().startsWith("<!--")
}

function dropHtmlComments(node: Nodes): void {
  if (!("children" in node)) return
  node.children = node.children.filter((child) => !isHtmlComment(child)) as typeof node.children
  node.children.forEach(dropHtmlComments)
}

// Raw HTML shows as text (it isn't rendered), but an <!-- comment --> is a marker meant for tools,
// such as a review note's "<!-- review-history:end -->", so it's left out entirely.
function remarkDropHtmlComments() {
  return (tree: Root) => dropHtmlComments(tree)
}

// GitHub-flavored markdown as the notes are written: tables, task lists and strikethrough (gfm),
// :shortcode: emoji, > [!NOTE]-style alerts, [[wiki]] links and syntax-highlighted fenced code.
const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm, remarkDropHtmlComments, remarkEmoji, remarkAlert, remarkWikiLinks]

// highlight.js's common languages (swift, kotlin, bash, ts, ...). Only fences tagged with a language
// are highlighted; an unknown language renders as plain code.
const REHYPE_PLUGINS: Options["rehypePlugins"] = [[rehypeHighlight, { detect: false }]]

const COMPONENTS: Components = { a: NoteLink }

// typography's prose wraps inline code in literal backticks; the overrides drop them and draw a pill instead.
const PROSE_CLASSES = [
  "prose prose-sm dark:prose-invert max-w-none",
  "prose-headings:font-semibold prose-a:text-primary",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal",
  "prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
].join(" ")

// A note's body, rendered. `notePath` is the note's own path, which its relative links resolve against.
export function MarkdownBody({ notePath, children }: { notePath: string; children: string }) {
  return (
    <CurrentNotePathContext.Provider value={notePath}>
      <div className={`markdown-body ${PROSE_CLASSES}`}>
        <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
          {children}
        </Markdown>
      </div>
    </CurrentNotePathContext.Provider>
  )
}
