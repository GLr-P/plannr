// Contract between the main process (data, files, OS) and the renderer (UI).
// Every method is exposed over IPC as `${namespace}:${method}`; see API_SHAPE.

/** Kinds of things that can be searched and linked. Grows with each phase (customer, ticket, event…). */
export type EntityType = 'note'

/** TipTap/ProseMirror document JSON. */
export type DocJSON = {
  type: string
  content?: DocJSON[]
  attrs?: Record<string, unknown>
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface Folder {
  id: string
  name: string
  sort: number
  createdAt: number
  updatedAt: number
}

export interface NoteSummary {
  id: string
  title: string
  folderId: string | null
  pinned: boolean
  tags: string[]
  preview: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Note extends NoteSummary {
  content: DocJSON | null
}

export interface NoteListOptions {
  /** undefined = all folders, null = unfiled only */
  folderId?: string | null
  tag?: string
  trashed?: boolean
}

export interface NoteUpdate {
  title?: string
  content?: DocJSON
  folderId?: string | null
  pinned?: boolean
  tags?: string[]
}

export interface SearchResult {
  type: EntityType
  id: string
  title: string
  /** Body excerpt; matched terms are wrapped in \u0001 … \u0002 */
  snippet: string
  updatedAt: number
}

export interface Backlink {
  type: EntityType
  id: string
  title: string
}

export interface StoredFile {
  id: string
  name: string
  mime: string
  size: number
  url: string
}

export interface AppInfo {
  version: string
  dataDir: string
}

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export interface PlannrApi {
  notes: {
    list(opts?: NoteListOptions): Promise<NoteSummary[]>
    get(id: string): Promise<Note | null>
    create(input?: { title?: string; folderId?: string | null }): Promise<Note>
    update(id: string, patch: NoteUpdate): Promise<NoteSummary>
    trash(id: string): Promise<void>
    restore(id: string): Promise<void>
    destroy(id: string): Promise<void>
    backlinks(id: string): Promise<Backlink[]>
    tags(): Promise<string[]>
  }
  folders: {
    list(): Promise<Folder[]>
    create(name: string): Promise<Folder>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
  }
  search: {
    query(q: string, opts?: { limit?: number; types?: EntityType[] }): Promise<SearchResult[]>
  }
  files: {
    save(input: { name: string; mime: string; data: Uint8Array }): Promise<StoredFile>
  }
  settings: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    setTheme(theme: Theme): Promise<void>
  }
}

export const API_SHAPE = {
  notes: ['list', 'get', 'create', 'update', 'trash', 'restore', 'destroy', 'backlinks', 'tags'],
  folders: ['list', 'create', 'rename', 'remove'],
  search: ['query'],
  files: ['save'],
  settings: ['get', 'set'],
  app: ['info', 'openDataFolder', 'setTheme']
} as const satisfies { [K in keyof PlannrApi]: readonly (keyof PlannrApi[K])[] }

// Compile-time check that API_SHAPE lists every method of PlannrApi.
type MissingMethods = {
  [K in keyof PlannrApi]: Exclude<keyof PlannrApi[K], (typeof API_SHAPE)[K][number]>
}[keyof PlannrApi]
export const API_SHAPE_COMPLETE: [MissingMethods] extends [never] ? true : never = true
