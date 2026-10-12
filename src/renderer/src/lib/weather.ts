/** A small picture for a weather code (Open-Meteo / WMO) */
export function weatherEmoji(code: number): string {
  if (code <= 1) return '☀️'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌧️'
}

export const weekdayShort = (date: string): string => new Date(`${date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })
