// Minimal ambient types for the FileSystemObserver API (Chrome 133+).
// Not yet covered by @types/wicg-file-system-access.

interface FileSystemObserverObservation {
  root: FileSystemHandle
  changedHandle: FileSystemHandle
  relativePathComponents: string[]
  relativePathMovedFrom?: string[]
  type: "appeared" | "disappeared" | "modified" | "moved" | "unknown" | "errored"
}

type FileSystemObserverCallback = (
  records: FileSystemObserverObservation[],
  observer: FileSystemObserver,
) => void

interface FileSystemObserveOptions {
  recursive?: boolean
}

declare class FileSystemObserver {
  constructor(callback: FileSystemObserverCallback)
  observe(handle: FileSystemHandle, options?: FileSystemObserveOptions): Promise<void>
  unobserve(handle: FileSystemHandle): void
  disconnect(): void
}
