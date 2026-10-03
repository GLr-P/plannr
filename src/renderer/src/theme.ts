import { create } from 'zustand'
import type { Theme, ThemePref } from '../../shared/api'
import { api } from './api'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

const resolve = (pref: ThemePref): Theme => (pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref)

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  void api.app.setTheme(theme)
}

interface ThemeState {
  pref: ThemePref
  setPref: (pref: ThemePref) => void
}

export const useTheme = create<ThemeState>((set) => ({
  pref: 'system',
  setPref: (pref) => {
    set({ pref })
    apply(resolve(pref))
    void api.settings.set('theme', pref)
  }
}))

/** Loads the saved preference and follows Windows light/dark changes. */
export async function initTheme(): Promise<void> {
  const saved = ((await api.settings.get('theme')) as ThemePref | null) ?? 'system'
  useTheme.setState({ pref: saved })
  apply(resolve(saved))
  darkQuery.addEventListener('change', () => {
    if (useTheme.getState().pref === 'system') apply(resolve('system'))
  })
}
