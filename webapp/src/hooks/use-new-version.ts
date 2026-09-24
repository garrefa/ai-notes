import { useEffect, useState } from "react"

// How often an open tab checks whether a newer build has been deployed. It also checks whenever
// the tab becomes visible again, which is when a stale tab is most likely to be noticed.
const CHECK_INTERVAL_MS = 5 * 60_000

async function fetchDeployedBuildId(): Promise<string | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}${__APP_VERSION_FILE__}`, { cache: "no-store" })
  if (!response.ok) return null
  const data: unknown = await response.json()
  if (typeof data !== "object" || data === null || !("buildId" in data)) return null
  return typeof data.buildId === "string" ? data.buildId : null
}

// True once the server has a different build than the one running in this tab. Always false in
// `npm run dev` (Vite reloads the page itself there, and there's no version file to poll).
export function useNewVersionAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV || available) return

    let cancelled = false
    const check = async () => {
      try {
        const deployed = await fetchDeployedBuildId()
        if (!cancelled && deployed && deployed !== __APP_BUILD_ID__) setAvailable(true)
      } catch {
        // Offline, or the host doesn't serve the file: try again on the next check.
      }
    }
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void check()
    }

    const timer = setInterval(check, CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", checkWhenVisible)
    window.addEventListener("focus", check)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", checkWhenVisible)
      window.removeEventListener("focus", check)
    }
  }, [available])

  return available
}
