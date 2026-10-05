export const HOME_SECTIONS = [
  { id: 'coming', label: 'Coming up (next 7 days)' },
  { id: 'tickets', label: 'Open tickets' },
  { id: 'pinned', label: 'Pinned notes' },
  { id: 'recent', label: 'Recent notes' }
] as const
export type HomeSection = (typeof HOME_SECTIONS)[number]['id']
const IDS = HOME_SECTIONS.map((s) => s.id) as HomeSection[]

export function homeOrder(pref: string | undefined): HomeSection[] {
  const saved = (pref ?? '').split(',').filter((id): id is HomeSection => (IDS as string[]).includes(id))
  return [...new Set([...saved, ...IDS])]
}
export const hiddenList = (pref: string | undefined): string[] => (pref ?? '').split(',').filter(Boolean)
