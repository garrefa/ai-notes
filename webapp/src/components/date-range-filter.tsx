import { useState } from "react"

import { CollapsibleSidebarGroup, SidebarGroupAction } from "@/components/collapsible-sidebar-group"
import { FilterChip } from "@/components/filter-chip"
import { Input } from "@/components/ui/input"
import {
  DATE_RANGE_MODES,
  DEFAULT_DATE_RANGE,
  describeDateRange,
  isDefaultDateRange,
  MAX_LAST_DAYS,
  type DateRangeFilter as DateRange,
} from "@/lib/date-range"

const COLLAPSE_KEY = "ainotes-date-range-collapsed"

function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <Input
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 px-2 text-xs"
      />
    </label>
  )
}

// Keeps what's typed while it isn't a valid count yet (an emptied field, say), and only
// reports whole numbers in range; leaving the field restores the last valid value.
function LastDaysInput({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      max={MAX_LAST_DAYS}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value)
        const days = e.target.valueAsNumber
        if (Number.isInteger(days) && days >= 1 && days <= MAX_LAST_DAYS) onChange(days)
      }}
      onBlur={() => setDraft(null)}
      className="h-7 w-16 px-2 text-xs"
      aria-label="Number of days"
    />
  )
}

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (next: DateRange) => void }) {
  const update = (patch: Partial<DateRange>) => onChange({ ...value, ...patch })

  return (
    <CollapsibleSidebarGroup
      title="Date range"
      storageKey={COLLAPSE_KEY}
      collapsedByDefault
      summary={describeDateRange(value)}
      action={
        !isDefaultDateRange(value) && (
          <SidebarGroupAction onClick={() => update({ mode: DEFAULT_DATE_RANGE.mode, lastDays: DEFAULT_DATE_RANGE.lastDays })}>
            Reset
          </SidebarGroupAction>
        )
      }
      contentClassName="space-y-2 px-2"
    >
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
        {DATE_RANGE_MODES.map((m) => (
          <FilterChip key={m.mode} on={value.mode === m.mode} onClick={() => update({ mode: m.mode })}>
            {m.mode === "last" ? `Last ${value.lastDays} ${value.lastDays === 1 ? "day" : "days"}` : m.label}
          </FilterChip>
        ))}
      </div>
      {value.mode === "last" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Counting today">
          Last
          <LastDaysInput value={value.lastDays} onChange={(lastDays) => update({ lastDays })} />
          {value.lastDays === 1 ? "day" : "days"}
        </label>
      )}
      {value.mode === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <DateInput label="From" value={value.customFrom} max={value.customTo} onChange={(customFrom) => update({ customFrom })} />
          <DateInput label="To" value={value.customTo} min={value.customFrom} onChange={(customTo) => update({ customTo })} />
        </div>
      )}
    </CollapsibleSidebarGroup>
  )
}
