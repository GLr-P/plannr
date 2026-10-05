import { create } from 'zustand'
import { displayPrefs, setDisplayPrefs, type DisplayPrefs } from '../../../shared/api'
import { api } from '../api'

/**
 * Display preferences (ticket prefix, currency, status names…). They live in the shared formatters;
 * `version` bumps when they change so the app re-renders with the new names.
 */
export const useDisplay = create<{ version: number; prefs: DisplayPrefs }>(() => ({ version: 0, prefs: displayPrefs() }))

export async function loadDisplay(): Promise<void> {
  setDisplayPrefs(await api.display.get())
  useDisplay.setState((s) => ({ version: s.version + 1, prefs: { ...displayPrefs() } }))
}

export async function saveDisplay(patch: Partial<DisplayPrefs>): Promise<void> {
  setDisplayPrefs(await api.display.set(patch))
  useDisplay.setState((s) => ({ version: s.version + 1, prefs: { ...displayPrefs() } }))
}
