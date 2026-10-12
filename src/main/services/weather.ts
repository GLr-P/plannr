import type { Db } from '../db'
import type { DayForecast, WeatherForecast } from '../../shared/api'
import { newsPrefs, type FetchText } from './news'
import { getSetting, setSetting } from './settings'

/** Two weeks of daily weather for your place (the one chosen in News), from Open-Meteo (free, no key). */

const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms',
  99: 'Thunderstorms'
}
export const weatherText = (code: number): string => WMO[code] ?? ''

export function parseDaily(json: string, place: string, now = Date.now()): WeatherForecast {
  const d = JSON.parse(json) as { daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[] } }
  const days: DayForecast[] = (d.daily?.time ?? []).map((date, i) => {
    const code = d.daily?.weather_code?.[i] ?? 0
    return {
      date,
      code,
      text: weatherText(code),
      max: Math.round(d.daily?.temperature_2m_max?.[i] ?? 0),
      min: Math.round(d.daily?.temperature_2m_min?.[i] ?? 0),
      rain: Math.round(d.daily?.precipitation_probability_max?.[i] ?? 0)
    }
  })
  return { place, days, fetchedAt: now }
}

/** The stored forecast, downloading a new one when it's older than 3 hours (or the place changed) */
export async function forecast(db: Db, fetchText: FetchText, now = Date.now()): Promise<WeatherForecast | null> {
  const place = newsPrefs(db).place
  if (!place) return null
  const saved = getSetting(db, 'weather.daily') as (WeatherForecast & { key?: string }) | null
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`
  if (saved && saved.key === key && now - saved.fetchedAt < 3 * 3_600_000) return saved
  try {
    const json = await fetchText(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lon.toFixed(3)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=14`
    )
    const next = { ...parseDaily(json, place.name, now), key }
    setSetting(db, 'weather.daily', next)
    return next
  } catch {
    return saved ?? null // offline: the last one
  }
}
