import { useState } from "react"
import { Check, ChevronsUpDown, FlaskConical, FolderPlus, FolderSearch, KeyRound, LogOut, NotebookText, Pencil, Trash2, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import type { WorkspaceSummary } from "@/hooks/use-notes-directory"
import { cn } from "@/lib/utils"

function RenameDialog({
  workspace,
  onClose,
  onRename,
}: {
  workspace: WorkspaceSummary
  onClose: () => void
  onRename: (id: string, label: string) => void
}) {
  const [draft, setDraft] = useState(workspace.label)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            onRename(workspace.id, draft)
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Only changes the name shown here — the folder on disk is untouched.</DialogDescription>
          </DialogHeader>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Folder name" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceSwitcher({
  workspaces,
  active,
  onSwitch,
  onAdd,
  onStartDemo,
  onExitDemo,
  onRename,
  onRemove,
  onLocate,
  onOpen,
}: {
  workspaces: WorkspaceSummary[]
  active: WorkspaceSummary | null
  onSwitch: (id: string) => void
  // null when this browser can't connect folders (the demo still works there).
  onAdd: (() => void) | null
  onStartDemo: () => void
  onExitDemo: () => void
  onRename: (id: string, label: string) => void
  onRemove: (id: string) => void
  onLocate: (id: string) => void
  // Fired when the menu opens, so per-folder availability indicators can be refreshed.
  onOpen: () => void
}) {
  const [renaming, setRenaming] = useState<WorkspaceSummary | null>(null)
  const demoLoaded = workspaces.some((ws) => ws.demo)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Non-modal so opening the rename dialog from a menu item doesn't fight the menu's focus trap. */}
        <DropdownMenu modal={false} onOpenChange={(open) => open && onOpen()}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent" aria-label="Switch notes folder">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <NotebookText className="size-3.5" />
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-semibold tracking-tight">AINotes</span>
                <span className="truncate text-xs text-muted-foreground">{active?.label ?? "No folder connected"}</span>
              </span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-72" align="start" side="bottom">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Notes folders</DropdownMenuLabel>
            {workspaces.map((ws) => {
              const isActive = ws.id === active?.id
              const missing = ws.availability === "missing"
              return (
                <div key={ws.id} className="flex items-center gap-0.5">
                  {/* Selecting a missing folder retries it (its drive may be back). */}
                  <DropdownMenuItem
                    className={cn("min-w-0 flex-1", missing && "text-muted-foreground")}
                    onSelect={() => onSwitch(ws.id)}
                  >
                    <Check className={isActive ? "" : "invisible"} />
                    <span className={cn("truncate", missing && "line-through decoration-muted-foreground/50")}>{ws.label}</span>
                    {ws.demo ? (
                      <span className="ml-auto rounded-full border border-border px-1.5 text-[10px] text-muted-foreground" title="Sample data, kept in memory">
                        Demo
                      </span>
                    ) : missing ? (
                      <span className="ml-auto flex items-center gap-1 text-[10px]" title="This folder couldn't be found">
                        <TriangleAlert className="size-3" />
                        Missing
                      </span>
                    ) : (
                      ws.availability === "needs-access" && (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground" title="Access needs to be granted again">
                          <KeyRound className="size-3" />
                          Grant access
                        </span>
                      )
                    )}
                  </DropdownMenuItem>
                  {missing && (
                    <DropdownMenuItem
                      className="px-1.5"
                      aria-label={`Remove ${ws.label} from list`}
                      title="Remove from list"
                      onSelect={() => onRemove(ws.id)}
                    >
                      <Trash2 />
                    </DropdownMenuItem>
                  )}
                  {/* A demo has no folder on disk to locate, rename or forget: "Exit demo" drops both. */}
                  {!ws.demo && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="px-1" aria-label={`Options for ${ws.label}`} />
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => onLocate(ws.id)}>
                          <FolderSearch />
                          Locate…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRenaming(ws)}>
                          <Pencil />
                          Rename…
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => onRemove(ws.id)}>
                          <Trash2 />
                          Remove from list
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </div>
              )
            })}
            {workspaces.length > 0 && <DropdownMenuSeparator />}
            {onAdd && (
              <DropdownMenuItem onSelect={onAdd}>
                <FolderPlus />
                Add folder…
              </DropdownMenuItem>
            )}
            {demoLoaded ? (
              <DropdownMenuItem onSelect={onExitDemo}>
                <LogOut />
                Exit demo
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onStartDemo}>
                <FlaskConical />
                Try the demo
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      {renaming && (
        <RenameDialog key={renaming.id} workspace={renaming} onClose={() => setRenaming(null)} onRename={onRename} />
      )}
    </SidebarMenu>
  )
}
