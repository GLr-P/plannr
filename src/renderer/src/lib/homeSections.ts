export const HOME_SECTIONS = [
  { id: 'coming', label: 'Coming up (next 7 days)' },
  { id: 'tasks', label: 'Tasks due' },
  { id: 'tickets', label: 'Open tickets' },
  { id: 'pinned', label: 'Pinned notes' },
  { id: 'recent', label: 'Recent notes' },
  { id: 'news', label: 'Local news' },
  { id: 'weather', label: 'Weather (next days)' },
  { id: 'habits', label: 'Today’s habits' },
  { id: 'lists', label: 'Shopping & lists' },
  { id: 'packages', label: 'Packages on the way' },
  { id: 'money', label: 'Money this month' },
  { id: 'deals', label: 'Top picks (games, deals…)' },
  { id: 'live', label: 'Live now & new videos' }
] as const
export type HomeSection = (typeof HOME_SECTIONS)[number]['id']
const IDS = HOME_SECTIONS.map((s) => s.id) as HomeSection[]

export function homeOrder(pref: string | undefined): HomeSection[] {
  const saved = (pref ?? '').split(',').filter((id): id is HomeSection => (IDS as string[]).includes(id))
  return [...new Set([...saved, ...IDS])]
}
export const hiddenList = (pref: string | undefined): string[] => (pref ?? '').split(',').filter(Boolean)
