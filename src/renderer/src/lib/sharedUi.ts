import { api } from '../api'
import { useUi } from '../store/ui'
import { useData } from '../store/data'

/**
 * Your layout and look follow you to your other PCs: the menu's groups and hidden items, Home's order and tiles,
 * colours and density, and a few reading choices. Kept in the synced setting 'ui.shared'; the newest change wins.
 * What a PC is showing right now (open tab, filters, the list you're on) stays on that PC.
 */
export const SHARED_UI_PREFS = [
  'navGroups',
  'navHidden',
  'homeOrder',
  'homeTiles',
  'homeHidden',
  'palette',
  'accent',
  'density',
  'entShorts',
  'sidebarRecent',
  'notesSort',
  'newsHideRead',
  'podSpeed',
  'printSetup'
]
const KEY = 'ui.shared'
const STAMP_KEY = 'plannr-ui-shared-at'

const pick = (prefs: Record<string, string>): Record<string, string> => Object.fromEntries(SHARED_UI_PREFS.filter((k) => k in prefs).map((k) => [k, prefs[k]]))
const localAt = (): number => {
  try {
    return Number(localStorage.getItem(STAMP_KEY)) || 0
  } catch {
    return 0
  }
}
const setLocalAt = (at: number): void => {
  try {
    localStorage.setItem(STAMP_KEY, String(at))
  } catch {
    // not remembered: the next start compares again
  }
}

export function startSharedUi(): () => void {
  let applying = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const pull = async (): Promise<void> => {
    const remote = (await api.settings.get(KEY)) as { prefs?: Record<string, string>; at?: number } | null
    const mine = localAt()
    if (remote?.prefs && (remote.at ?? 0) > mine) {
      applying = true
      useUi.setState((s) => ({ prefs: { ...s.prefs, ...pick(remote.prefs!) } }))
      applying = false
      setLocalAt(remote.at ?? 0)
    } else if (!remote && Object.keys(pick(useUi.getState().prefs)).length) {
      push() // first PC to share: send what it has
    }
  }
  const push = (): void => {
    const at = Date.now()
    setLocalAt(at)
    void api.settings.set(KEY, { prefs: pick(useUi.getState().prefs), at })
  }

  void pull()
  const offUi = useUi.subscribe((s, before) => {
    if (applying) return
    if (JSON.stringify(pick(s.prefs)) === JSON.stringify(pick(before.prefs))) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(push, 800)
  })
  const offRemote = useData.subscribe((s, before) => {
    if (s.remote !== before.remote) void pull()
  })
  return () => {
    offUi()
    offRemote()
    if (timer) clearTimeout(timer)
  }
}
