import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Per-device UI preferences, remembered between launches. */
interface UiState {
  collapsed: Record<string, boolean>
  toggle: (key: string) => void
  setCollapsed: (key: string, value: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      collapsed: {},
      toggle: (key) => set((s) => ({ collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } })),
      setCollapsed: (key, value) => set((s) => ({ collapsed: { ...s.collapsed, [key]: value } }))
    }),
    { name: 'plannr-ui' }
  )
)
