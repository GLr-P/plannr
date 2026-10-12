import { create } from 'zustand'
import { displayPrefs, setDisplayPrefs, type DisplayPrefs } from '../../../shared/api'
import { api } from '../api'

/**
 * Display preferences (ticket prefix, currency, status names…). They live in the shared formatters;
 * `version` bumps when they change so the app re-renders with the new names.
 */
export const useDisplay = create<{ version: number; prefs: DisplayPrefs }>(() => ({ version: 0, prefs: displayPrefs() }))

/** Reloads them (another device may have changed them). Only an actual change re-renders the page, so a sync
 *  doesn't throw you back to the top of whatever you're reading. */
export async function loadDisplay(): Promise<void> {
  const before = JSON.stringify(displayPrefs())
  setDisplayPrefs(await api.display.get())
  if (JSON.stringify(displayPrefs()) === before) return
  useDisplay.setState((s) => ({ version: s.version + 1, prefs: { ...displayPrefs() } }))
}

export async function saveDisplay(patch: Partial<DisplayPrefs>): Promise<void> {
  setDisplayPrefs(await api.display.set(patch))
  useDisplay.setState((s) => ({ version: s.version + 1, prefs: { ...displayPrefs() } }))
}

/** Your name for a menu item (e.g. Tickets → Orders), updating when it's changed */
export function useNavName(id: string, fallback: string): string {
  const names = useDisplay((s) => s.prefs.navNames)
  return names?.[id]?.trim() || fallback
}
