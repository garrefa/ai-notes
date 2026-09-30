import { useState } from "react"
import { Heart } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The small heart a favorited note shows in lists.
export function FavoriteMark({ className }: { className?: string }) {
  return <Heart aria-label="Favorite" className={cn("favorite-heart size-3.5 shrink-0", className)} />
}

// Toggles a note's favorite state; pops the heart when it's switched on.
export function FavoriteButton({ favorite, onToggle }: { favorite: boolean; onToggle: () => void }) {
  const [popKey, setPopKey] = useState(0)
  const label = favorite ? "Remove from favorites" : "Add to favorites"
  return (
    <Button
      size="icon-sm"
      variant="outline"
      aria-pressed={favorite}
      aria-label={label}
      title={label}
      onClick={() => {
        if (!favorite) setPopKey((k) => k + 1)
        onToggle()
      }}
    >
      {/* Re-keyed on every "add" so the pop animation replays. */}
      <span key={popKey} className={cn("inline-flex", popKey > 0 && favorite && "favorite-pop")}>
        <Heart className={cn(favorite ? "favorite-heart" : "text-muted-foreground")} />
      </span>
    </Button>
  )
}
