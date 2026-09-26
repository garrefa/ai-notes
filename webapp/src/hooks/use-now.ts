import { useEffect, useState } from "react"

// The current time, re-read every `tickMs` so relative times ("3m ago") keep moving even when
// nothing else re-renders.
export function useNow(tickMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])
  return now
}
