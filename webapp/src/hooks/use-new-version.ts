import { useEffect, useState } from "react"

// How often an open tab checks whether a newer build has been deployed. It also checks whenever
// the tab becomes visible again, which is when a stale tab is most likely to be noticed.
const CHECK_INTERVAL_MS = 5 * 60_000

export interface DeployedBuild {
  buildId: string
  // The deployed release number; null when the host serves a version.json from before it carried one.
  version: string | null
}

async function fetchDeployedBuild(): Promise<DeployedBuild | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}${__APP_VERSION_FILE__}`, { cache: "no-store" })
  if (!response.ok) return null
  const data: unknown = await response.json()
  if (typeof data !== "object" || data === null || !("buildId" in data) || typeof data.buildId !== "string") return null
  const version = "version" in data && typeof data.version === "string" ? data.version : null
  return { buildId: data.buildId, version }
}

// The build the server now has, once it differs from the one running in this tab; null until then.
// The build ID is the trigger (a redeploy between releases changes code but not the version); the
// release number is carried along so the notice can say what's new. Always null in `npm run dev`
// (Vite reloads the page itself there, and there's no version file to poll).
export function useNewerDeployment(): DeployedBuild | null {
  const [newer, setNewer] = useState<DeployedBuild | null>(null)

  useEffect(() => {
    if (import.meta.env.DEV || newer) return

    let cancelled = false
    const check = async () => {
      try {
        const deployed = await fetchDeployedBuild()
        if (!cancelled && deployed && deployed.buildId !== __APP_BUILD_ID__) setNewer(deployed)
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
  }, [newer])

  return newer
}
