import { useCallback, useState } from "react"

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback
}

// Busy / notice / error state around one kind of write (a save, a status change, a delete, ...).
// `run` resolves to whether the work succeeded; a string the work returns is shown as a
// non-blocking notice (e.g. "TASKS.md wasn't found ...").
export function useAsyncAction(fallbackError: string) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (work: () => Promise<string | null | void>): Promise<boolean> => {
      setBusy(true)
      setNotice(null)
      setError(null)
      try {
        const result = await work()
        if (typeof result === "string") setNotice(result)
        return true
      } catch (e) {
        setError(errorMessage(e, fallbackError))
        return false
      } finally {
        setBusy(false)
      }
    },
    [fallbackError],
  )

  const reset = useCallback(() => {
    setNotice(null)
    setError(null)
  }, [])

  return { busy, notice, error, run, reset }
}
