// The sidebar's Library items and the per-browser order the user dragged them into. Stored in
// localStorage like the status settings; any storage failure falls back to the default order.

import { useCallback, useState } from "react"

export type LibraryView = "all" | "notes" | "plans" | "daily" | "tasks" | "prs" | "agents"

export const DEFAULT_LIBRARY_ORDER: LibraryView[] = ["all", "notes", "plans", "daily", "tasks", "prs", "agents"]

export const LIBRARY_ORDER_KEY = "ainotes-library-order"

// Keeps the stored order's known items, then appends any item added since it was saved.
export function normalizeLibraryOrder(stored: unknown): LibraryView[] {
  const known = new Set<string>(DEFAULT_LIBRARY_ORDER)
  const kept = Array.isArray(stored)
    ? stored.filter((v, i, all): v is LibraryView => typeof v === "string" && known.has(v) && all.indexOf(v) === i)
    : []
  return [...kept, ...DEFAULT_LIBRARY_ORDER.filter((v) => !kept.includes(v))]
}

function loadLibraryOrder(): LibraryView[] {
  try {
    const text = localStorage.getItem(LIBRARY_ORDER_KEY)
    return normalizeLibraryOrder(text ? JSON.parse(text) : null)
  } catch {
    return [...DEFAULT_LIBRARY_ORDER]
  }
}

function isDefaultOrder(order: LibraryView[]): boolean {
  return order.every((v, i) => v === DEFAULT_LIBRARY_ORDER[i])
}

function saveLibraryOrder(order: LibraryView[]): void {
  try {
    if (isDefaultOrder(order)) localStorage.removeItem(LIBRARY_ORDER_KEY)
    else localStorage.setItem(LIBRARY_ORDER_KEY, JSON.stringify(order))
  } catch {
    // Not persisted (storage unavailable); the new order still applies for this session.
  }
}

// Moves `view` so it ends up at `toIndex` in the resulting list.
export function moveLibraryItem(order: LibraryView[], view: LibraryView, toIndex: number): LibraryView[] {
  const rest = order.filter((v) => v !== view)
  const index = Math.max(0, Math.min(toIndex, rest.length))
  return [...rest.slice(0, index), view, ...rest.slice(index)]
}

export function useLibraryOrder() {
  const [order, setOrder] = useState<LibraryView[]>(loadLibraryOrder)

  const apply = useCallback((next: LibraryView[]) => {
    setOrder(next)
    saveLibraryOrder(next)
  }, [])

  const move = useCallback((view: LibraryView, toIndex: number) => apply(moveLibraryItem(order, view, toIndex)), [apply, order])

  return { order, move }
}
