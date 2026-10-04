import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Per-device UI preferences, remembered between launches. */
interface UiState {
  collapsed: Record<string, boolean>
  /** Small string preferences, e.g. calendarView */
  prefs: Record<string, string>
  toggle: (key: string) => void
  setCollapsed: (key: string, value: boolean) => void
  setPref: (key: string, value: string) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      collapsed: {},
      prefs: {},
      toggle: (key) => set((s) => ({ collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } })),
      setCollapsed: (key, value) => set((s) => ({ collapsed: { ...s.collapsed, [key]: value } })),
      setPref: (key, value) => set((s) => ({ prefs: { ...s.prefs, [key]: value } }))
    }),
    { name: 'plannr-ui' }
  )
)
