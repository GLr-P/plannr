import { create } from 'zustand'
import { api } from '../api'
import { blankCopy, sectionLibrary, SECTIONS_KEY, type SectionDef, type SectionLibrary } from '../../../shared/ticket-sections'
import type { DocJSON } from '../../../shared/api'

/**
 * Your ticket sections (saved from a ticket, or your version of a built-in one) and the built-in ones you hid.
 * Kept in the synced setting 'tickets.sections', so the phone and other PCs get them too.
 */
interface SectionsState {
  lib: SectionLibrary
  loaded: boolean
  load: () => Promise<void>
  save: (lib: SectionLibrary) => Promise<void>
  /** Saves a section from a ticket (answers emptied); returns its id */
  saveSection: (def: Omit<SectionDef, 'content'> & { content: DocJSON[] }) => Promise<string>
  remove: (id: string) => Promise<void>
  setHidden: (id: string, hidden: boolean) => Promise<void>
}

export const useSections = create<SectionsState>((set, get) => ({
  lib: { custom: [], hidden: [] },
  loaded: false,
  load: async () => set({ lib: sectionLibrary(await api.settings.get(SECTIONS_KEY)), loaded: true }),
  save: async (lib) => {
    set({ lib })
    await api.settings.set(SECTIONS_KEY, lib)
  },
  saveSection: async (def) => {
    const { lib, save } = get()
    const clean: SectionDef = { ...def, content: blankCopy(def.content) }
    const custom = lib.custom.some((c) => c.id === def.id) ? lib.custom.map((c) => (c.id === def.id ? clean : c)) : [...lib.custom, clean]
    await save({ ...lib, custom })
    return def.id
  },
  remove: async (id) => {
    const { lib, save } = get()
    await save({ ...lib, custom: lib.custom.filter((c) => c.id !== id) })
  },
  setHidden: async (id, hidden) => {
    const { lib, save } = get()
    await save({ ...lib, hidden: hidden ? [...new Set([...lib.hidden, id])] : lib.hidden.filter((h) => h !== id) })
  }
}))

/** A new id for a section you make */
export const newSectionId = (): string => `my:${crypto.randomUUID()}`
