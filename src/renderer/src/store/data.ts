import { create } from 'zustand'
import type { Folder, NoteSummary } from '../../../shared/api'
import { api } from '../api'

/** App-wide cache of lightweight lists (sidebar, home, search suggestions). */
interface DataState {
  notes: NoteSummary[]
  folders: Folder[]
  loaded: boolean
  counts: { open: number; ready: number }
  refreshCounts: () => Promise<void>
  refresh: () => Promise<void>
  upsertNote: (note: NoteSummary) => void
}

export const useData = create<DataState>((set, get) => ({
  notes: [],
  folders: [],
  loaded: false,
  counts: { open: 0, ready: 0 },
  refreshCounts: async () => set({ counts: await api.tickets.counts() }),
  refresh: async () => {
    const [notes, folders, counts] = await Promise.all([api.notes.list(), api.folders.list(), api.tickets.counts()])
    set({ notes, folders, counts, loaded: true })
  },
  upsertNote: (note) => {
    const others = get().notes.filter((n) => n.id !== note.id)
    if (note.deletedAt !== null) return set({ notes: others })
    const notes = [note, ...others].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    set({ notes })
  }
}))
