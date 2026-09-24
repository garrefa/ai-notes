// A minimal in-memory stand-in for the File System Access API: just the directory/file handle
// surface notes-fs.ts and workspace-loader.ts use. It lets the demo workspaces go through the
// exact same load, edit and task-status code paths as a real folder, without touching disk,
// asking for permission, or needing a browser that supports showDirectoryPicker.

type Entry = MemoryDirectory | MemoryFile

function notFound(name: string): DOMException {
  return new DOMException(`"${name}" was not found.`, "NotFoundError")
}

function typeMismatch(name: string): DOMException {
  return new DOMException(`"${name}" is not the expected kind of entry.`, "TypeMismatchError")
}

class MemoryFile {
  readonly kind = "file"
  private content: string
  private lastModified: number
  readonly name: string

  constructor(name: string, content: string, lastModified: number) {
    this.name = name
    this.content = content
    this.lastModified = lastModified
  }

  async getFile(): Promise<File> {
    return new File([this.content], this.name, { type: "text/markdown", lastModified: this.lastModified })
  }

  async createWritable() {
    let draft = ""
    return {
      write: async (data: string) => {
        draft += data
      },
      close: async () => {
        this.content = draft
        this.lastModified = Date.now()
      },
    }
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this
  }
}

class MemoryDirectory {
  readonly kind = "directory"
  private readonly children = new Map<string, Entry>()
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  async *keys(): AsyncIterableIterator<string> {
    yield* this.children.keys()
  }

  async *entries(): AsyncIterableIterator<[string, Entry]> {
    yield* this.children.entries()
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    const existing = this.children.get(name)
    if (existing instanceof MemoryDirectory) return existing
    if (existing) throw typeMismatch(name)
    if (!options?.create) throw notFound(name)
    const created = new MemoryDirectory(name)
    this.children.set(name, created)
    return created
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    const existing = this.children.get(name)
    if (existing instanceof MemoryFile) return existing
    if (existing) throw typeMismatch(name)
    if (!options?.create) throw notFound(name)
    const created = new MemoryFile(name, "", Date.now())
    this.children.set(name, created)
    return created
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted"
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted"
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this
  }

  addFile(path: string, content: string, lastModified: number) {
    const [head, ...rest] = path.split("/")
    if (!head) throw new Error(`Not a file path: ${path}`)
    if (rest.length === 0) {
      this.setChild(new MemoryFile(head, content, lastModified))
      return
    }
    const existing = this.children.get(head)
    if (existing instanceof MemoryFile) throw new Error(`"${head}" is a file, not a folder.`)
    const dir = existing ?? this.setChild(new MemoryDirectory(head))
    dir.addFile(rest.join("/"), content, lastModified)
  }

  private setChild<T extends Entry>(entry: T): T {
    this.children.set(entry.name, entry)
    return entry
  }
}

// Builds a folder named `name` holding `files` (path relative to that folder → file contents).
export function createMemoryDirectory(
  name: string,
  files: Record<string, string>,
  lastModified = Date.now(),
): FileSystemDirectoryHandle {
  const root = new MemoryDirectory(name)
  for (const [path, content] of Object.entries(files)) root.addFile(path, content, lastModified)
  return root as unknown as FileSystemDirectoryHandle
}
