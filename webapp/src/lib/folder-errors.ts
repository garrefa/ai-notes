// The ways a tracked folder can fail to open, normalized into one error type the UI can show.

export type UnavailableReason = "missing" | "unreadable" | "timeout" | "failed"

export class FolderUnavailableError extends Error {
  readonly reason: UnavailableReason

  constructor(reason: UnavailableReason, message: string) {
    super(message)
    this.name = "FolderUnavailableError"
    this.reason = reason
  }
}

class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function toFolderUnavailable(e: unknown, label: string): FolderUnavailableError {
  if (e instanceof FolderUnavailableError) return e
  if (e instanceof TimeoutError) {
    return new FolderUnavailableError("timeout", `"${label}" isn't responding. Is its drive connected?`)
  }
  if (e instanceof DOMException && e.name === "NotFoundError") {
    return new FolderUnavailableError(
      "missing",
      `"${label}" couldn't be found. It may have been moved, renamed or deleted, or its drive isn't connected.`,
    )
  }
  if (e instanceof DOMException && e.name === "NotReadableError") {
    return new FolderUnavailableError("unreadable", `"${label}" can't be read right now.`)
  }
  const detail = e instanceof Error && e.message ? ` (${e.message})` : ""
  return new FolderUnavailableError("failed", `"${label}" couldn't be opened${detail}.`)
}
