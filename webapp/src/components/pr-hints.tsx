import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import type { Tone } from "@/lib/pr-view"

const TONE_CLASSES: Record<Tone, string> = {
  good: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  bad: "bg-red-600/10 text-red-700 dark:text-red-400",
  warn: "bg-amber-600/10 text-amber-700 dark:text-amber-400",
  neutral: "bg-muted text-muted-foreground",
}

// A compact colored status chip (CI, review state, behind base, ...).
export function ToneChip({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", TONE_CLASSES[tone], className)}>{children}</span>
}

// The rounded mono pill the notes list uses for tags; here for Jira keys, logins and teams.
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-full border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground", className)}>
      {children}
    </span>
  )
}
