import type { Route } from '../store/nav'

/** The main menu items, in their default order. The order you drag them into is saved as the `navOrder` pref. */
export const NAV_IDS = ['home', 'tasks', 'tickets', 'customers', 'calendar', 'money', 'inventory', 'notes', 'news', 'entertainment', 'lists', 'packages', 'mail', 'assistant'] as const
export type NavId = (typeof NAV_IDS)[number]

export const NAV_ROUTES: Record<NavId, Route> = {
  home: { view: 'home' },
  tasks: { view: 'tasks' },
  tickets: { view: 'tickets' },
  customers: { view: 'customers' },
  calendar: { view: 'calendar' },
  money: { view: 'money' },
  inventory: { view: 'inventory' },
  notes: { view: 'notes', filter: { kind: 'all' } },
  news: { view: 'news' },
  entertainment: { view: 'entertainment' },
  lists: { view: 'lists' },
  packages: { view: 'packages' },
  mail: { view: 'mail' },
  assistant: { view: 'assistant' }
}

export const NAV_LABELS: Record<NavId, string> = {
  home: 'Home',
  tasks: 'Tasks',
  tickets: 'Tickets',
  customers: 'Customers',
  calendar: 'Calendar',
  money: 'Money',
  inventory: 'Inventory',
  notes: 'Notes',
  news: 'News',
  entertainment: 'Entertainment',
  lists: 'Lists',
  packages: 'Packages',
  mail: 'Mail',
  assistant: 'Assistant'
}

/** A menu item's name: yours if you renamed it (Settings → Layout), else the standard one */
export const navName = (id: string, names: Partial<Record<string, string>> | undefined, fallback: string): string => names?.[id]?.trim() || fallback

/** One of them: "Orders" → "order", "Repairs" → "repair", "Tickets" → "ticket" */
export function singular(plural: string): string {
  const w = plural.trim()
  const one = /ies$/i.test(w) ? w.slice(0, -3) + 'y' : /(ss|us)$/i.test(w) ? w : /s$/i.test(w) ? w.slice(0, -1) : w
  return one.toLowerCase()
}

export function navOrder(pref: string | undefined): NavId[] {
  const saved = (pref ?? '').split(',').filter((id): id is NavId => (NAV_IDS as readonly string[]).includes(id))
  return [...new Set([...saved, ...NAV_IDS])]
}

/** The menu in groups, each with an optional heading and a divider above it */
export interface NavGroup {
  id: string
  name: string
  items: NavId[]
  collapsed?: boolean
}

export const DEFAULT_GROUPS: NavGroup[] = [
  { id: 'main', name: '', items: ['home', 'tasks', 'calendar'] },
  { id: 'work', name: 'Work', items: ['tickets', 'customers', 'money', 'inventory', 'mail'] },
  { id: 'organize', name: 'Organize', items: ['notes', 'lists', 'packages'] },
  { id: 'discover', name: 'Discover', items: ['news', 'entertainment', 'assistant'] }
]

/** Your groups (the `navGroups` pref), with every menu item in exactly one; new items go in the last group */
export function navGroups(pref: string | undefined): NavGroup[] {
  let raw: unknown = null
  try {
    raw = pref ? JSON.parse(pref) : null
  } catch {
    raw = null
  }
  const source = Array.isArray(raw) && raw.length ? (raw as Partial<NavGroup>[]) : DEFAULT_GROUPS
  const seen = new Set<string>()
  const groups: NavGroup[] = source.map((g, i) => ({
    id: String(g.id ?? `g${i}`),
    name: String(g.name ?? ''),
    collapsed: g.collapsed === true,
    items: (Array.isArray(g.items) ? g.items : []).filter((id): id is NavId => (NAV_IDS as readonly string[]).includes(id) && !seen.has(id) && Boolean(seen.add(id)))
  }))
  const missing = NAV_IDS.filter((id) => !seen.has(id))
  if (missing.length) groups[groups.length - 1].items.push(...missing)
  return groups
}

export const flatNav = (groups: NavGroup[]): NavId[] => groups.flatMap((g) => g.items)

/** Every item that can be hidden from the sidebar (Settings → General → Menu). */
export const HIDEABLE: { id: string; label: string }[] = [
  ...NAV_IDS.filter((id) => id !== 'home').map((id) => ({ id, label: NAV_LABELS[id] })),
  { id: 'vault', label: 'Vault' },
  { id: 'templates', label: 'Templates' }
]
export const navHidden = (pref: string | undefined): string[] => (pref ?? '').split(',').filter(Boolean)

/** The main menu as shown: your groups in order, minus hidden items (Ctrl+1–9 follow it). */
export const visibleNav = (groupsPref: string | undefined, hiddenPref: string | undefined): NavId[] =>
  flatNav(navGroups(groupsPref)).filter((id) => !navHidden(hiddenPref).includes(id))
