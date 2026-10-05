import { useEffect } from 'react'
import { useUi } from '../store/ui'

export const ACCENTS = [
  { id: 'blue', label: 'Blue', color: '#2f6ae0' },
  { id: 'purple', label: 'Purple', color: '#7c4ddb' },
  { id: 'teal', label: 'Teal', color: '#0f8c86' },
  { id: 'green', label: 'Green', color: '#1f8a4c' },
  { id: 'orange', label: 'Orange', color: '#d9661b' },
  { id: 'red', label: 'Red', color: '#d03b3b' },
  { id: 'pink', label: 'Pink', color: '#d23f86' },
  { id: 'graphite', label: 'Graphite', color: '#3c3c40' }
] as const

export const TEXT_SIZES = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Default' },
  { value: 1.1, label: 'Large' },
  { value: 1.25, label: 'Larger' }
] as const

/** Puts the chosen accent colour and spacing on <html> (CSS does the rest). */
export function useAppearance(): void {
  const accent = useUi((s) => s.prefs.accent) ?? 'blue'
  const density = useUi((s) => s.prefs.density) ?? 'comfortable'
  useEffect(() => {
    document.documentElement.dataset.accent = accent
    document.documentElement.dataset.density = density
  }, [accent, density])
}
