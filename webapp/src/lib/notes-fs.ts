import { toNote, sortNotes, type Note, type NoteSource } from "@/lib/notes-frontmatter"

const WATCHED_DIRS: NoteSource[] = ["notes", "plans", "daily", "tasks"]

async function readMarkdownFilesIn(dir: FileSystemDirectoryHandle, source: NoteSource): Promise<Note[]> {
  const notes: Note[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".md")) continue
    const fileHandle = handle as FileSystemFileHandle
    const file = await fileHandle.getFile()
    const raw = await file.text()
    notes.push(toNote(`${source}/${name}`, source, raw, file.lastModified))
  }
  return notes
}

async function getSubdirectory(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name, { create: false })
  } catch {
    return null
  }
}

export async function loadAllNotes(root: FileSystemDirectoryHandle): Promise<Note[]> {
  const results = await Promise.all(
    WATCHED_DIRS.map(async (source) => {
      const dir = await getSubdirectory(root, source)
      if (!dir) return []
      return readMarkdownFilesIn(dir, source)
    }),
  )
  return sortNotes(results.flat())
}

// PRS.md lives at the picked directory's root, alongside notes/plans/daily, not inside one of them.
export async function loadPrsFile(root: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const handle = await root.getFileHandle("PRS.md", { create: false })
    const file = await handle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

async function getNoteFileHandle(root: FileSystemDirectoryHandle, notePath: string): Promise<FileSystemFileHandle> {
  const slash = notePath.indexOf("/")
  if (slash < 0) throw new Error(`Not a valid note path: ${notePath}`)
  const dir = await root.getDirectoryHandle(notePath.slice(0, slash), { create: false })
  return dir.getFileHandle(notePath.slice(slash + 1), { create: false })
}

export async function saveNote(root: FileSystemDirectoryHandle, notePath: string, content: string): Promise<void> {
  const fileHandle = await getNoteFileHandle(root, notePath)
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}
