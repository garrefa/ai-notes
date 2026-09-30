import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"

const COPIED_FOR_MS = 1500

// A file path relative to the notes repo, with a button that copies it.
export function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(path)
      setFailed(false)
      setCopied(true)
    } catch {
      setFailed(true)
    }
  }

  const label = copied ? "Copied" : failed ? "Couldn't copy — select the path instead" : "Copy path"
  return (
    <div className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
      <span className="min-w-0 truncate select-all" title={path}>
        {path}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}
