import { useEffect } from 'react'
import { create } from 'zustand'
import { CalendarDays, CheckSquare, Home, Menu, Wrench } from 'lucide-react'
import { useNav, type Route } from '../store/nav'
import { useData } from '../store/data'

/** On a phone the sidebar slides in from the left (☰ in the title bar, or More in the tab bar). */
export const useDrawer = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))

const TABS: { label: string; icon: React.ReactNode; route: Route; match: Route['view'][] }[] = [
  { label: 'Home', icon: <Home />, route: { view: 'home' }, match: ['home'] },
  { label: 'Tasks', icon: <CheckSquare />, route: { view: 'tasks' }, match: ['tasks'] },
  { label: 'Tickets', icon: <Wrench />, route: { view: 'tickets' }, match: ['tickets', 'ticket'] },
  { label: 'Calendar', icon: <CalendarDays />, route: { view: 'calendar' }, match: ['calendar'] }
]

/** Phone only (hidden on wider screens by CSS): the tab bar at the bottom, and closing the drawer after navigating. */
export function MobileNav() {
  const view = useNav((s) => s.route.view)
  const route = useNav((s) => s.route)
  const open = useDrawer((s) => s.open)
  const setOpen = useDrawer((s) => s.set)
  const dueTasks = useData((s) => s.counts.dueTasks)
  useEffect(() => setOpen(false), [route, setOpen])
  return (
    <>
      <div className="drawer-backdrop" hidden={!open} onClick={() => setOpen(false)} />
      <nav className="mobile-tabs" aria-label="Tabs">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            className={t.match.includes(view) && !open ? 'active' : ''}
            aria-current={t.match.includes(view) ? 'page' : undefined}
            onClick={() => useNav.getState().go(t.route)}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.label === 'Tasks' && dueTasks > 0 && <span className="tab-badge">{dueTasks}</span>}
          </button>
        ))}
        <button type="button" className={open ? 'active' : ''} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Menu />
          <span>More</span>
        </button>
      </nav>
    </>
  )
}

/** ☰ in the title bar (phone only). */
export function DrawerButton() {
  const open = useDrawer((s) => s.open)
  return (
    <button type="button" className="icon-btn drawer-btn" aria-label="Menu" aria-expanded={open} onClick={() => useDrawer.getState().set(!open)}>
      <Menu />
    </button>
  )
}
