import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type ThemeMode = "light" | "dark" | "system"
export type ThemePalette = "zinc" | "slate" | "stone" | "violet"

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

export const THEME_PALETTES: { value: ThemePalette; label: string; accent: string }[] = [
  { value: "zinc", label: "Zinc · Blue", accent: "#2563eb" },
  { value: "slate", label: "Slate · Indigo", accent: "#4f46e5" },
  { value: "stone", label: "Stone · Amber", accent: "#b45309" },
  { value: "violet", label: "Neutral · Violet", accent: "#7c3aed" },
]

const MODE_KEY = "ainotes-theme-mode"
const PALETTE_KEY = "ainotes-theme-palette"
const DEFAULT_MODE: ThemeMode = "system"
const DEFAULT_PALETTE: ThemePalette = "violet"

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back silently
  }
  return fallback
}

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function applyTheme(mode: ThemeMode, palette: ThemePalette) {
  const root = document.documentElement
  const resolvedDark = mode === "dark" || (mode === "system" && systemPrefersDark())
  root.classList.toggle("dark", resolvedDark)
  root.setAttribute("data-palette", palette)
}

interface ThemeContextValue {
  mode: ThemeMode
  palette: ThemePalette
  resolvedMode: "light" | "dark"
  setMode: (mode: ThemeMode) => void
  setPalette: (palette: ThemePalette) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    readStored(MODE_KEY, ["light", "dark", "system"] as const, DEFAULT_MODE),
  )
  const [palette, setPaletteState] = useState<ThemePalette>(() =>
    readStored(PALETTE_KEY, ["zinc", "slate", "stone", "violet"] as const, DEFAULT_PALETTE),
  )
  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">(() =>
    mode === "dark" || (mode === "system" && systemPrefersDark()) ? "dark" : "light",
  )

  useEffect(() => {
    applyTheme(mode, palette)
    setResolvedMode(mode === "dark" || (mode === "system" && systemPrefersDark()) ? "dark" : "light")

    if (mode !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      applyTheme(mode, palette)
      setResolvedMode(systemPrefersDark() ? "dark" : "light")
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [mode, palette])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  const setPalette = useCallback((next: ThemePalette) => {
    setPaletteState(next)
    try {
      localStorage.setItem(PALETTE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  const value = useMemo(
    () => ({ mode, palette, resolvedMode, setMode, setPalette }),
    [mode, palette, resolvedMode, setMode, setPalette],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider")
  return ctx
}
