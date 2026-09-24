import { cn } from "@/lib/utils"
import type { ResolvedTaskStatus } from "@/lib/task-status"

// A task's status as a small colored dot. The configured color is used as-is; the thin ring keeps
// pale colors visible on light backgrounds and dark ones on dark backgrounds. Unknown statuses get
// a neutral dot. The label doubles as tooltip and accessible name.
export function TaskStatusDot({ status, className }: { status: Pick<ResolvedTaskStatus, "label" | "color">; className?: string }) {
  return (
    <span
      role="img"
      aria-label={status.label}
      title={status.label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/30",
        !status.color && "bg-muted-foreground/50",
        className,
      )}
      style={status.color ? { backgroundColor: status.color } : undefined}
    />
  )
}
