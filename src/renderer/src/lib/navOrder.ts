import type { Route } from '../store/nav'

/** The main menu items, in their default order. The order you drag them into is saved as the `navOrder` pref. */
export const NAV_IDS = ['home', 'tickets', 'customers', 'calendar', 'money', 'notes'] as const
export type NavId = (typeof NAV_IDS)[number]

export const NAV_ROUTES: Record<NavId, Route> = {
  home: { view: 'home' },
  tickets: { view: 'tickets' },
  customers: { view: 'customers' },
  calendar: { view: 'calendar' },
  money: { view: 'money' },
  notes: { view: 'notes', filter: { kind: 'all' } }
}

export const NAV_LABELS: Record<NavId, string> = {
  home: 'Home',
  tickets: 'Tickets',
  customers: 'Customers',
  calendar: 'Calendar',
  money: 'Money',
  notes: 'Notes'
}

export function navOrder(pref: string | undefined): NavId[] {
  const saved = (pref ?? '').split(',').filter((id): id is NavId => (NAV_IDS as readonly string[]).includes(id))
  return [...new Set([...saved, ...NAV_IDS])]
}
