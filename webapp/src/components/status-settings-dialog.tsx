import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { StatusSettings } from "@/lib/status-settings"
import { defaultTaskStatus, isBuiltinStatusKey, type TaskStatus } from "@/lib/task-status"
import { cn } from "@/lib/utils"

function ClosedSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: closed`}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        checked ? "bg-primary" : "bg-input dark:bg-muted-foreground/30",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

function StatusRow({ status, settings }: { status: TaskStatus; settings: StatusSettings }) {
  const defaults = defaultTaskStatus(status.key)
  const overridden = Boolean(settings.overrides[status.key])
  const change = (next: { color?: string; closed?: boolean }) => settings.updateStatus(status.key, next, defaults)

  return (
    <li className="flex items-center gap-3 py-2">
      <input
        type="color"
        value={status.color}
        onChange={(e) => change({ color: e.target.value })}
        aria-label={`${status.label}: color`}
        title="Change color"
        className="color-swatch-input size-7 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{status.label}</p>
        {status.label !== status.key && <p className="truncate font-mono text-[11px] text-muted-foreground">{status.key}</p>}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Closed
        <ClosedSwitch checked={status.closed} label={status.label} onChange={(closed) => change({ closed })} />
      </label>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!overridden}
        onClick={() => settings.resetStatus(status.key)}
        aria-label={`Reset ${status.label} to default`}
        title="Reset to default"
      >
        <RotateCcw />
      </Button>
    </li>
  )
}

function StatusGroup({ heading, statuses, settings }: { heading: string; statuses: TaskStatus[]; settings: StatusSettings }) {
  if (statuses.length === 0) return null
  return (
    <section>
      <h3 className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{heading}</h3>
      <ul className="divide-y divide-border">
        {statuses.map((s) => (
          <StatusRow key={s.key} status={s} settings={settings} />
        ))}
      </ul>
    </section>
  )
}

// Task status colors and "closed" flags, shared by every folder and stored in this browser only.
export function StatusSettingsDialog({
  open,
  onOpenChange,
  catalog,
  settings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Built-ins plus the statuses found in the open folder's tasks, with current settings applied.
  catalog: TaskStatus[]
  settings: StatusSettings
}) {
  const builtins = catalog.filter((s) => isBuiltinStatusKey(s.key))
  const discovered = catalog.filter((s) => !isBuiltinStatusKey(s.key))
  const anyOverridden = Object.keys(settings.overrides).length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Task status colors, and which statuses count as closed (hidden by the default filter and listed under
            Completed in TASKS.md). Saved in this browser and shared by every folder.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 space-y-4 overflow-y-auto px-4">
          <StatusGroup heading="Built-in statuses" statuses={builtins} settings={settings} />
          <StatusGroup heading="Found in this folder's tasks" statuses={discovered} settings={settings} />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" disabled={!anyOverridden} onClick={settings.resetAll} className="gap-2">
            <RotateCcw className="size-3.5" />
            Reset all to defaults
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
