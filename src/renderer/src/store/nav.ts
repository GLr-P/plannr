import { create } from 'zustand'

export type NotesFilter = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'tag'; tag: string } | { kind: 'trash' }

export type Route =
  | { view: 'home' }
  | { view: 'notes'; filter: NotesFilter }
  | { view: 'note'; id: string }
  | { view: 'tickets' }
  | { view: 'ticket'; id: string }
  | { view: 'customers' }
  | { view: 'customer'; id: string }
  | { view: 'templates' }
  | { view: 'template'; id: string }
  | { view: 'settings' }

interface NavState {
  route: Route
  past: Route[]
  future: Route[]
  go: (route: Route) => void
  replace: (route: Route) => void
  back: () => void
  forward: () => void
}

const same = (a: Route, b: Route): boolean => JSON.stringify(a) === JSON.stringify(b)

export const useNav = create<NavState>((set, get) => ({
  route: { view: 'home' },
  past: [],
  future: [],
  go: (route) => {
    const { route: current, past } = get()
    if (same(route, current)) return
    set({ route, past: [...past, current].slice(-100), future: [] })
  },
  replace: (route) => set({ route }),
  back: () => {
    const { past, route, future } = get()
    const prev = past.at(-1)
    if (prev) set({ route: prev, past: past.slice(0, -1), future: [route, ...future] })
  },
  forward: () => {
    const { past, route, future } = get()
    const next = future[0]
    if (next) set({ route: next, past: [...past, route], future: future.slice(1) })
  }
}))

export const go = (route: Route): void => useNav.getState().go(route)
