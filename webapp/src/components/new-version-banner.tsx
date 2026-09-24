import { useState } from "react"
import { RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useNewVersionAvailable } from "@/hooks/use-new-version"

// Floating notice shown once a newer build has been deployed. Reloading is left to the user, since
// it would throw away an unsaved edit or the demo's in-memory changes.
export function NewVersionBanner() {
  const available = useNewVersionAvailable()
  const [dismissed, setDismissed] = useState(false)
  if (!available || dismissed) return null

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex-1 space-y-2">
        <p>
          <span className="font-medium">A new version of AINotes is available.</span>{" "}
          <span className="text-muted-foreground">Save any edits, then reload to get it.</span>
        </p>
        <Button size="sm" className="gap-2" onClick={() => window.location.reload()}>
          <RefreshCw className="size-3.5" />
          Reload
        </Button>
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  )
}
