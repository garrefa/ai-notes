import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

const CHIP_BASE = "rounded-full border px-2 py-0.5 text-[11px] transition-colors"
const CHIP_ON = "border-primary bg-primary/10 text-primary"
const CHIP_OFF = "border-border text-muted-foreground hover:border-primary/50"

// A toggle chip for the list views' filter rows (PR state and repo, agent status).
export function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}>
      {children}
    </button>
  )
}
