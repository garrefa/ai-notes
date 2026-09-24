// Per-browser task status settings (color, closed), keyed by status key and shared by every
// workspace. Stored in localStorage; any storage failure (private mode, blocked site data,
// corrupt JSON) silently falls back to the built-in defaults.

import { useCallback, useEffect, useState } from "react"

import { isHexColor, type StatusOverride, type StatusOverrides } from "@/lib/task-status"

export const STATUS_SETTINGS_KEY = "ainotes-task-status-settings"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseOverride(value: unknown): StatusOverride | null {
  if (!isRecord(value)) return null
  const override: StatusOverride = {}
  if (isHexColor(value.color)) override.color = value.color.toLowerCase()
  if (typeof value.closed === "boolean") override.closed = value.closed
  return Object.keys(override).length > 0 ? override : null
}

export function parseStatusOverrides(text: string | null): StatusOverrides {
  if (!text) return {}
  try {
    const doc: unknown = JSON.parse(text)
    if (!isRecord(doc)) return {}
    const result: StatusOverrides = {}
    for (const [key, value] of Object.entries(doc)) {
      const override = parseOverride(value)
      if (override) result[key] = override
    }
    return result
  } catch {
    return {}
  }
}

export function loadStatusOverrides(): StatusOverrides {
  try {
    return parseStatusOverrides(localStorage.getItem(STATUS_SETTINGS_KEY))
  } catch {
    return {}
  }
}

function saveStatusOverrides(overrides: StatusOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STATUS_SETTINGS_KEY)
    else localStorage.setItem(STATUS_SETTINGS_KEY, JSON.stringify(overrides))
  } catch {
    // Not persisted (storage unavailable); the change still applies for this session.
  }
}

// Merges a change into one status's override, dropping fields that match the default so a
// status edited back to its default stops being stored.
export function withStatusOverride(
  overrides: StatusOverrides,
  key: string,
  change: StatusOverride,
  defaults: { color: string; closed: boolean },
): StatusOverrides {
  const merged: StatusOverride = { ...overrides[key], ...change }
  if (merged.color !== undefined && merged.color.toLowerCase() === defaults.color.toLowerCase()) delete merged.color
  if (merged.closed === defaults.closed) delete merged.closed
  const { [key]: _previous, ...rest } = overrides
  return Object.keys(merged).length > 0 ? { ...rest, [key]: merged } : rest
}

export function useStatusSettings() {
  const [overrides, setOverrides] = useState<StatusOverrides>(loadStatusOverrides)

  // Another tab changed the settings: pick them up so every open tab agrees.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STATUS_SETTINGS_KEY || e.key === null) setOverrides(loadStatusOverrides())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const commit = useCallback((next: StatusOverrides) => {
    setOverrides(next)
    saveStatusOverrides(next)
  }, [])

  const updateStatus = useCallback(
    (key: string, change: StatusOverride, defaults: { color: string; closed: boolean }) => {
      commit(withStatusOverride(overrides, key, change, defaults))
    },
    [commit, overrides],
  )

  const resetStatus = useCallback(
    (key: string) => {
      const { [key]: _removed, ...rest } = overrides
      commit(rest)
    },
    [commit, overrides],
  )

  const resetAll = useCallback(() => commit({}), [commit])

  return { overrides, updateStatus, resetStatus, resetAll }
}

export type StatusSettings = ReturnType<typeof useStatusSettings>
