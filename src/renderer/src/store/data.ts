import { create } from 'zustand'
import type { Folder, NoteSummary, SidebarSection } from '../../../shared/api'
import { api } from '../api'

/** App-wide cache of lightweight lists (sidebar, home, search suggestions). */
interface DataState {
  notes: NoteSummary[]
  folders: Folder[]
  sections: SidebarSection[]
  loaded: boolean
  counts: { open: number; ready: number; lowStock: number; dueTasks: number }
  refreshCounts: () => Promise<void>
  refresh: () => Promise<void>
  upsertNote: (note: NoteSummary) => void
}

export const useData = create<DataState>((set, get) => ({
  notes: [],
  folders: [],
  sections: [],
  loaded: false,
  counts: { open: 0, ready: 0, lowStock: 0, dueTasks: 0 },
  refreshCounts: async () => {
    const [tickets, lowStock, dueTasks] = await Promise.all([api.tickets.counts(), api.parts.lowCount(), api.tasks.dueCount()])
    set({ counts: { ...tickets, lowStock, dueTasks } })
  },
  refresh: async () => {
    const [notes, folders, sections, counts, lowStock, dueTasks] = await Promise.all([
      api.notes.list(),
      api.folders.list(),
      api.sidebar.sections(),
      api.tickets.counts(),
      api.parts.lowCount(),
      api.tasks.dueCount()
    ])
    set({ notes, folders, sections, counts: { ...counts, lowStock, dueTasks }, loaded: true })
  },
  upsertNote: (note) => {
    const others = get().notes.filter((n) => n.id !== note.id)
    if (note.deletedAt !== null) return set({ notes: others })
    const notes = [note, ...others].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    set({ notes })
  }
}))
