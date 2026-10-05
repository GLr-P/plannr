import { useEffect } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { useUi } from '../store/ui'
import { NAV_LABELS, navOrder } from '../lib/navOrder'

export const useShortcutsOpen = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))

const Keys = ({ k }: { k: string }) => (
  <span className="keys">
    {k.split('+').map((part) => (
      <kbd key={part}>{part}</kbd>
    ))}
  </span>
)

/** Ctrl+/ (or Settings → Keyboard shortcuts): every shortcut on one page. */
export function ShortcutsDialog() {
  const { open, set } = useShortcutsOpen()
  const order = navOrder(useUi((s) => s.prefs.navOrder))
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') set(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, set])
  if (!open) return null

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Anywhere',
      rows: [
        ['Ctrl+K', 'Search everything'],
        ['Ctrl+N', 'New note'],
        ['Ctrl+T', 'New ticket'],
        ...order.map((id, i): [string, string] => [`Ctrl+${i + 1}`, `Go to ${NAV_LABELS[id]}`]),
        ['Ctrl+,', 'Settings'],
        ['Alt+←', 'Back'],
        ['Alt+→', 'Forward'],
        ['Ctrl+/', 'This list']
      ]
    },
    {
      title: 'In a note or ticket',
      rows: [
        ['/', 'Insert a heading, checklist, toggle, image…'],
        ['@', 'Link a note, customer or ticket'],
        ['Ctrl+B', 'Bold'],
        ['Ctrl+I', 'Italic'],
        ['Ctrl+U', 'Underline'],
        ['Ctrl+Z', 'Undo'],
        ['Ctrl+Shift+Z', 'Redo'],
        ['Enter', 'From the title, jump into the text']
      ]
    },
    {
      title: 'Sidebar',
      rows: [
        ['Right-click', 'Rename, icon & colour, move, delete'],
        ['Drag', 'Reorder, or drop into a folder or section']
      ]
    }
  ]

  return (
    <div className="dialog-backdrop" onMouseDown={() => set(false)}>
      <div className="dialog shortcuts" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => set(false)}>
            <X />
          </button>
        </div>
        <div className="shortcut-groups">
          {groups.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              {g.rows.map(([k, what]) => (
                <div key={k + what} className="shortcut-row">
                  <span>{what}</span>
                  <Keys k={k} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
