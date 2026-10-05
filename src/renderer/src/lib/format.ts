import { formatCurrency } from '../../../shared/api'
const DAY = 86_400_000

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  const d = new Date(ms)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (ms >= today.getTime()) return `${Math.floor(diff / 3_600_000)}h ago`
  if (ms >= today.getTime() - DAY) return 'Yesterday'
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

export const noteTitle = (title: string): string => title.trim() || 'Untitled'

export function greeting(date = new Date()): string {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return ''
  return formatCurrency(cents)
}

/** "$1,299.50" / "1299.5" / "" → cents (or null when empty/invalid). */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

/** "2026-10-09" → "Fri, Oct 9" (adds the year when it isn't this year). */
export function formatDay(date: string | null): string {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const sameYear = y === new Date().getFullYear()
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
