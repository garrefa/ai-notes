import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export interface ConfirmAction {
  label: string
  onClick: () => void
  variant?: "default" | "destructive" | "outline" | "ghost"
}

// A small modal asking the user to pick one of a few actions (delete / cancel, save / discard / keep
// editing). Closing it any other way (Esc, the overlay, the ×) counts as cancelling.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actions,
  busy = false,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  // Left to right; the last one is the primary action and gets focus.
  actions: ConfirmAction[]
  busy?: boolean
  error?: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {actions.map((action, i) => (
            <Button
              key={action.label}
              variant={action.variant ?? "outline"}
              disabled={busy}
              autoFocus={i === actions.length - 1}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
