import { cn } from "@/lib/utils"
import type { TaskStatus } from "@/lib/task-status"

// A task's status as a small colored dot. The status color is used as-is; the thin ring keeps
// pale colors visible on light backgrounds and dark ones on dark backgrounds. The label doubles as
// tooltip and accessible name.
export function TaskStatusDot({ status, className }: { status: Pick<TaskStatus, "label" | "color">; className?: string }) {
  return (
    <span
      role="img"
      aria-label={status.label}
      title={status.label}
      className={cn("inline-block size-2 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/30", className)}
      style={{ backgroundColor: status.color }}
    />
  )
}
