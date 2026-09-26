import { useState, type DragEvent, type KeyboardEvent } from "react"
import { Bot, CalendarDays, GitPullRequest, GripVertical, ListChecks, ListTodo, NotebookText, StickyNote, type LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useLibraryOrder, type LibraryView } from "@/lib/library-order"
import { cn } from "@/lib/utils"

const LIBRARY_ITEMS: Record<LibraryView, { label: string; icon: LucideIcon }> = {
  all: { label: "All notes", icon: StickyNote },
  notes: { label: "Notes", icon: NotebookText },
  plans: { label: "Plans", icon: ListTodo },
  daily: { label: "Daily", icon: CalendarDays },
  tasks: { label: "Tasks", icon: ListChecks },
  prs: { label: "Pull requests", icon: GitPullRequest },
  agents: { label: "Agents", icon: Bot },
}

// What an item's badge shows. `alert` swaps in the animated "Needs you" badge.
export interface LibraryCount {
  count: number
  title: string
  alert?: boolean
}

type DropTarget = { view: LibraryView; after: boolean }

export function LibraryMenu({
  view,
  onViewChange,
  counts,
}: {
  view: LibraryView
  onViewChange: (view: LibraryView) => void
  // Missing (e.g. before a folder is connected) means no badge.
  counts: Partial<Record<LibraryView, LibraryCount>>
}) {
  const { order, move } = useLibraryOrder()
  const [dragging, setDragging] = useState<LibraryView | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)

  function endDrag() {
    setDragging(null)
    setDrop(null)
  }

  function onDragOver(e: DragEvent<HTMLLIElement>, target: LibraryView) {
    if (!dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    const box = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > box.top + box.height / 2
    if (drop?.view !== target || drop.after !== after) setDrop({ view: target, after })
  }

  function onDrop(e: DragEvent<HTMLLIElement>) {
    e.preventDefault()
    if (dragging && drop) {
      const rest = order.filter((v) => v !== dragging)
      move(dragging, rest.indexOf(drop.view) + (drop.after ? 1 : 0))
    }
    endDrag()
  }

  // Alt+↑ / Alt+↓ moves the focused item, so reordering doesn't need a mouse.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, item: LibraryView) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
    e.preventDefault()
    move(item, order.indexOf(item) + (e.key === "ArrowUp" ? -1 : 1))
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Library</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {order.map((item) => {
            const { label, icon: Icon } = LIBRARY_ITEMS[item]
            const badge = counts[item]
            const dropHere = drop?.view === item && dragging !== item
            return (
              <SidebarMenuItem
                key={item}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move"
                  e.dataTransfer.setData("text/plain", label)
                  setDragging(item)
                }}
                onDragOver={(e) => onDragOver(e, item)}
                onDrop={onDrop}
                onDragEnd={endDrag}
                className={cn(
                  dragging === item && "opacity-40",
                  dropHere && "before:absolute before:inset-x-1 before:h-0.5 before:rounded-full before:bg-primary",
                  dropHere && (drop.after ? "before:-bottom-px" : "before:-top-px"),
                )}
              >
                <SidebarMenuButton
                  isActive={view === item}
                  onClick={() => onViewChange(item)}
                  onKeyDown={(e) => onKeyDown(e, item)}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  className="pr-14"
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
                {badge && (
                  <SidebarMenuBadge title={badge.title} className={cn("right-6", badge.alert && "needs-you-badge")}>
                    {badge.count}
                  </SidebarMenuBadge>
                )}
                {/* The drag handle sits after the counter; the whole row is draggable, the grip says so. */}
                <GripVertical
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/menu-item:opacity-70 group-focus-within/menu-item:opacity-70"
                />
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
