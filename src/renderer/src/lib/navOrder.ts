import type { Route } from '../store/nav'

/** The main menu items, in their default order. The order you drag them into is saved as the `navOrder` pref. */
export const NAV_IDS = ['home', 'tickets', 'customers', 'calendar', 'money', 'inventory', 'notes'] as const
export type NavId = (typeof NAV_IDS)[number]

export const NAV_ROUTES: Record<NavId, Route> = {
  home: { view: 'home' },
  tickets: { view: 'tickets' },
  customers: { view: 'customers' },
  calendar: { view: 'calendar' },
  money: { view: 'money' },
  inventory: { view: 'inventory' },
  notes: { view: 'notes', filter: { kind: 'all' } }
}

export const NAV_LABELS: Record<NavId, string> = {
  home: 'Home',
  tickets: 'Tickets',
  customers: 'Customers',
  calendar: 'Calendar',
  money: 'Money',
  inventory: 'Inventory',
  notes: 'Notes'
}

export function navOrder(pref: string | undefined): NavId[] {
  const saved = (pref ?? '').split(',').filter((id): id is NavId => (NAV_IDS as readonly string[]).includes(id))
  return [...new Set([...saved, ...NAV_IDS])]
}

/** Every item that can be hidden from the sidebar (Settings → General → Menu). */
export const HIDEABLE: { id: string; label: string }[] = [
  ...NAV_IDS.filter((id) => id !== 'home').map((id) => ({ id, label: NAV_LABELS[id] })),
  { id: 'vault', label: 'Vault' },
  { id: 'templates', label: 'Templates' }
]
export const navHidden = (pref: string | undefined): string[] => (pref ?? '').split(',').filter(Boolean)

/** The main menu as shown: your order, minus hidden items. */
export const visibleNav = (orderPref: string | undefined, hiddenPref: string | undefined): NavId[] =>
  navOrder(orderPref).filter((id) => !navHidden(hiddenPref).includes(id))
