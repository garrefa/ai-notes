import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"

import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar"
import { useStoredCollapsed } from "@/hooks/use-stored-collapsed"
import { cn } from "@/lib/utils"

// A sidebar filter section that folds away. While folded, `summary` keeps the active filter
// visible in its header, and `action` (e.g. a Clear button) stays reachable.
export function CollapsibleSidebarGroup({
  title,
  storageKey,
  collapsedByDefault = false,
  summary,
  action,
  contentClassName,
  children,
}: {
  title: string
  storageKey: string
  collapsedByDefault?: boolean
  summary?: string | null
  action?: ReactNode
  contentClassName?: string
  children: ReactNode
}) {
  const [collapsed, toggle] = useStoredCollapsed(storageKey, collapsedByDefault)

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between gap-2">
        <button onClick={toggle} aria-expanded={!collapsed} className="flex min-w-0 items-center gap-1 hover:text-foreground">
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")} />
          {title}
          {summary && <span className="truncate font-normal text-primary normal-case">· {summary}</span>}
        </button>
        {action}
      </SidebarGroupLabel>
      {!collapsed && <SidebarGroupContent className={contentClassName}>{children}</SidebarGroupContent>}
    </SidebarGroup>
  )
}

// The small "Clear"/"Reset" link that sits at the right of a sidebar section header.
export function SidebarGroupAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="shrink-0 font-normal text-primary normal-case">
      {children}
    </button>
  )
}
