import { useEffect } from 'react'
import { useUi } from '../store/ui'
import { syncTitleBar } from '../theme'

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

/** Colour themes: each has light and dark colours (styles/themes.css); previews show page, sidebar, text */
export const PALETTES = [
  { id: 'default', label: 'Plannr', text: 'Clean white and grey', colors: ['#ffffff', '#f6f6f4', '#22221f'] },
  { id: 'paper', label: 'Paper', text: 'Warm and soft, easy on the eyes', colors: ['#f9f4e8', '#f1e9d6', '#3a3226'] },
  { id: 'solarized', label: 'Solarized', text: 'Low-contrast classic', colors: ['#fdf6e3', '#eee8d5', '#3d4f55'] },
  { id: 'dim', label: 'Dim', text: 'Muted greys, less glare', colors: ['#f1f1ef', '#e9e9e6', '#333330'] },
  { id: 'nord', label: 'Nord', text: 'Cool arctic blues', colors: ['#eceff4', '#e5e9f0', '#2e3440'] },
  { id: 'forest', label: 'Forest', text: 'Calm greens', colors: ['#f4f7f2', '#ebf0e7', '#253025'] },
  { id: 'rose', label: 'Rosé', text: 'Soft pinks and purples', colors: ['#faf4ed', '#f2e9e1', '#575279'] },
  { id: 'midnight', label: 'Midnight', text: 'True black in dark mode', colors: ['#000000', '#0d0d0f', '#e6e6e6'] },
  { id: 'contrast', label: 'High contrast', text: 'Strongest text and borders', colors: ['#ffffff', '#000000', '#000000'] }
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
  const palette = useUi((s) => s.prefs.palette) || 'default'
  useEffect(() => {
    document.documentElement.dataset.accent = accent
    document.documentElement.dataset.density = density
    document.documentElement.dataset.palette = palette
    syncTitleBar() // the window's own title bar takes the theme's colours
  }, [accent, density, palette])
}
