import type { Db } from '../db'
import { NOTE_LIBRARY } from '../../shared/note-library'
import { getSetting, setSetting } from './settings'
import { createTemplate } from './templates'

/* Starter note templates ("types" of note), created once: the ones for everyone. The setup adds the ones for what you
   do (shared/note-library.ts). They're ordinary templates: edit or delete them freely. */

export const STARTER_NOTE_TEMPLATES = NOTE_LIBRARY.filter((t) => !t.uses).map(({ name, icon, content }) => ({ name, icon, content }))

/** Creates the starter note templates the first time this version runs. */
export function ensureStarterNoteTemplates(db: Db): void {
  if (getSetting(db, 'starterNoteTemplatesCreated')) return
  for (const t of STARTER_NOTE_TEMPLATES) createTemplate(db, { ...t, kind: 'note' })
  setSetting(db, 'starterNoteTemplatesCreated', true)
}
