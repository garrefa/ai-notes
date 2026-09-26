// The sidebar's date filter: the last N days (counting today; 7 by default), or a custom range.
// Resolves to the inclusive YYYY-MM-DD bounds the notes and PR filters compare against.

import { localIsoDate } from "@/lib/notes-frontmatter"

export type DateRangeMode = "last" | "custom"

export interface DateRangeFilter {
  mode: DateRangeMode
  lastDays: number
  customFrom: string
  customTo: string
}

export const DEFAULT_LAST_DAYS = 7
export const MAX_LAST_DAYS = 3650

export const DEFAULT_DATE_RANGE: DateRangeFilter = { mode: "last", lastDays: DEFAULT_LAST_DAYS, customFrom: "", customTo: "" }

export const DATE_RANGE_MODES: { mode: DateRangeMode; label: string }[] = [
  // Labelled with the chosen count at render time ("Last 7 days").
  { mode: "last", label: "Last days" },
  { mode: "custom", label: "Custom" },
]

// Empty strings mean "unbounded" on that side, as the date inputs use.
export interface DateBounds {
  from: string
  to: string
}

export function clampLastDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LAST_DAYS
  return Math.min(MAX_LAST_DAYS, Math.max(1, Math.round(value)))
}

export function resolveDateRange(filter: DateRangeFilter, today = new Date()): DateBounds {
  if (filter.mode === "last") {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (clampLastDays(filter.lastDays) - 1))
    return { from: localIsoDate(start), to: "" }
  }
  return { from: filter.customFrom, to: filter.customTo }
}

export function isDefaultDateRange(filter: DateRangeFilter): boolean {
  return filter.mode === DEFAULT_DATE_RANGE.mode && filter.lastDays === DEFAULT_DATE_RANGE.lastDays
}

// Short summary for the collapsed header, e.g. "Last 7 days", "Mar 2 – Mar 9", "Since Mar 2".
export function describeDateRange(filter: DateRangeFilter): string | null {
  if (filter.mode === "last") {
    const days = clampLastDays(filter.lastDays)
    return days === 1 ? "Today" : `Last ${days} days`
  }
  const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const { customFrom: from, customTo: to } = filter
  if (from && to) return `${short(from)} – ${short(to)}`
  if (from) return `Since ${short(from)}`
  if (to) return `Until ${short(to)}`
  return null
}
