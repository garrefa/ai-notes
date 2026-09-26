import { useState } from "react"
import { RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useNewerDeployment, type DeployedBuild } from "@/hooks/use-new-version"

// "AINotes v0.2.0 is available (you're on v0.1.0)." for a new release; for a redeploy of the same
// release (or a host whose version.json doesn't carry a version yet), just that a new build exists.
function describeNewer(newer: DeployedBuild): string {
  if (newer.version && newer.version !== __APP_VERSION__) {
    return `AINotes v${newer.version} is available (you're on v${__APP_VERSION__}).`
  }
  return `A new build of AINotes v${newer.version ?? __APP_VERSION__} is available.`
}

// Floating notice shown once a newer build has been deployed. Reloading is left to the user, since
// it would throw away an unsaved edit or the demo's in-memory changes.
export function NewVersionBanner() {
  const newer = useNewerDeployment()
  const [dismissed, setDismissed] = useState(false)
  if (!newer || dismissed) return null

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex-1 space-y-2">
        <p>
          <span className="font-medium">{describeNewer(newer)}</span>{" "}
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
