import { ListPlus } from "lucide-react"

import { Button } from "@/components/ui/button"

// Starts a new task that references the item it's on (a note, plan, daily plan, PR or agent).
export function AddTaskButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={onClick} title="Create a task that references this">
      <ListPlus className="size-3.5" />
      Add task
    </Button>
  )
}
