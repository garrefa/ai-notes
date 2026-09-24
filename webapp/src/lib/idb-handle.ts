// Persists the list of tracked notes folders ("workspaces") and which one was
// last active. Each workspace holds the FileSystemDirectoryHandle the user
// picked; handles are structured-cloneable, so IndexedDB (not localStorage,
// which is string-only) is the right place for them.

const DB_NAME = "ainotes"
const DB_VERSION = 1
const STORE_NAME = "directory-handles"
const WORKSPACES_KEY = "workspaces"
const ACTIVE_WORKSPACE_KEY = "active-workspace"
// Before multi-folder support the app stored a single handle under this key.
// It's migrated into the workspace list (and removed) the first time the app loads.
const LEGACY_HANDLE_KEY = "notes-root"

export interface Workspace {
  id: string
  // Defaults to the picked folder's name; the user can rename it.
  label: string
  // The folder the user picked: either the notes repo root or its db/ folder.
  // The data dir inside it is resolved on every open (see resolveDataDir).
  handle: FileSystemDirectoryHandle
  addedAt: number
  lastOpenedAt: number
}

export interface WorkspaceState {
  workspaces: Workspace[]
  activeId: string | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function requestValue<T>(req: IDBRequest): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function newWorkspace(handle: FileSystemDirectoryHandle, now = Date.now()): Workspace {
  return { id: crypto.randomUUID(), label: handle.name, handle, addedAt: now, lastOpenedAt: now }
}

// Reads the workspace list, migrating a legacy single stored handle into it.
// Runs in one readwrite transaction so concurrent callers (e.g. React
// StrictMode's double-invoked effects) are serialized and migrate only once.
export async function loadWorkspaceState(): Promise<WorkspaceState> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const done = transactionDone(tx)

    const [stored, activeId, legacy] = await Promise.all([
      requestValue<Workspace[]>(store.get(WORKSPACES_KEY)),
      requestValue<string>(store.get(ACTIVE_WORKSPACE_KEY)),
      requestValue<FileSystemDirectoryHandle>(store.get(LEGACY_HANDLE_KEY)),
    ])

    let state: WorkspaceState = { workspaces: stored ?? [], activeId: activeId ?? null }
    if (legacy) {
      if (state.workspaces.length === 0) {
        const migrated = newWorkspace(legacy)
        state = { workspaces: [migrated], activeId: migrated.id }
        store.put(state.workspaces, WORKSPACES_KEY)
        store.put(migrated.id, ACTIVE_WORKSPACE_KEY)
      }
      store.delete(LEGACY_HANDLE_KEY)
    }

    await done
    return state
  } catch {
    return { workspaces: [], activeId: null }
  }
}

async function putValue(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, "readwrite")
  const store = tx.objectStore(STORE_NAME)
  if (value === null) store.delete(key)
  else store.put(value, key)
  await transactionDone(tx)
}

export function saveWorkspaces(workspaces: Workspace[]): Promise<void> {
  return putValue(WORKSPACES_KEY, workspaces)
}

export function saveActiveWorkspaceId(id: string | null): Promise<void> {
  return putValue(ACTIVE_WORKSPACE_KEY, id)
}
