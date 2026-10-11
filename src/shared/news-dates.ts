/**
 * Finds when something in a news story happens ("Saturday, Oct. 17 from 8 a.m. to 8 p.m."), so it can go on
 * the calendar in one click. Pure; dates are read relative to when the story was published.
 */

export interface NewsWhen {
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, or null for all day */
  startTime: string | null
  endTime: string | null
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const MONTH_DAY = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi')
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4}))?`, 'gi')
/** A weekday on its own counts only when it clearly points ahead ("this Saturday", "on Friday at 7 pm") */
const WEEKDAY = /\b(this|next|on|until|starting|from|begins?|happening|held)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi
const RELATIVE = /\b(today|tonight|tomorrow|this weekend)\b/i
const TIME_RANGE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
const TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(noon)\b/i

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function to24(h: number, m: number, ampm: string | undefined): string | null {
  if (h > 12 || m > 59) return null
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return `${pad(h)}:${pad(m)}`
}

/** The time of day mentioned in the text, if any */
export function findTimes(text: string): { startTime: string | null; endTime: string | null } {
  const t = normalize(text)
  const range = TIME_RANGE.exec(t)
  if (range) {
    const endAmpm = range[6]
    const startAmpm = range[3] ?? (Number(range[1]) > Number(range[4]) && endAmpm === 'pm' ? 'am' : endAmpm)
    const startTime = to24(Number(range[1]), Number(range[2] ?? 0), startAmpm)
    const endTime = to24(Number(range[4]), Number(range[5] ?? 0), endAmpm)
    if (startTime && endTime) return { startTime, endTime }
  }
  const one = TIME.exec(t)
  if (one) return { startTime: one[4] ? '12:00' : to24(Number(one[1]), Number(one[2] ?? 0), one[3]), endTime: null }
  return { startTime: null, endTime: null }
}

/** a.m. → am, so the patterns stay simple */
const normalize = (text: string): string => text.replace(/\b([ap])\.\s?m\.?/gi, (_m, x: string) => `${x.toLowerCase()}m`).replace(/\b([AP])M\b/g, (m) => m.toLowerCase())

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase())
}

/** Every date the text names, in the order they appear */
export function findDates(text: string, published: Date): { date: Date; at: number; strong: boolean }[] {
  const base = startOfDay(published)
  const out: { date: Date; at: number; strong: boolean }[] = []
  const explicit = (month: number, day: number, year: string | undefined, at: number): void => {
    if (month < 0 || day < 1 || day > 31) return
    let d = new Date(year ? Number(year) : base.getFullYear(), month, day)
    if (d.getMonth() !== month) return // e.g. Feb 30
    // No year given and it reads as months ago: it's next year's (a January event announced in December)
    if (!year && d.getTime() < addDays(base, -60).getTime()) d = new Date(base.getFullYear() + 1, month, day)
    out.push({ date: d, at, strong: true })
  }
  for (const m of text.matchAll(MONTH_DAY)) explicit(monthIndex(m[1]), Number(m[2]), m[3], m.index ?? 0)
  for (const m of text.matchAll(DAY_MONTH)) explicit(monthIndex(m[2]), Number(m[1]), m[3], m.index ?? 0)
  for (const m of text.matchAll(WEEKDAY)) {
    const target = WEEKDAYS.indexOf(m[2].toLowerCase())
    let ahead = (target - base.getDay() + 7) % 7
    if (m[1].toLowerCase() === 'next' && ahead === 0) ahead = 7
    out.push({ date: addDays(base, ahead), at: m.index ?? 0, strong: false })
  }
  const rel = RELATIVE.exec(text)
  if (rel) {
    const word = rel[1].toLowerCase()
    const ahead = word === 'tomorrow' ? 1 : word === 'this weekend' ? (6 - base.getDay() + 7) % 7 : 0
    out.push({ date: addDays(base, ahead), at: rel.index, strong: false })
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * When the story's event happens: the first named date on or after the day it was published (named dates win
 * over "this Saturday"), with a time if one is mentioned. Null when it only mentions past dates or none.
 */
export function findWhen(text: string, published: Date): NewsWhen | null {
  const base = startOfDay(published).getTime()
  const dates = findDates(text, published).filter((d) => d.date.getTime() >= base)
  const pick = dates.find((d) => d.strong) ?? dates[0]
  if (!pick) return null
  return { date: ymd(pick.date), ...findTimes(text) }
}
