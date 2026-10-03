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
