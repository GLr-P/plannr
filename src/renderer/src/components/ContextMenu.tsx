import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Check, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { COLORS, ICONS, colorStyle } from '../lib/icons'

/*
 * One right-click menu for the whole app. Callers build a list of entries and call openMenu(event, entries).
 * Entries can open a sub-list (children) or a custom panel (e.g. the icon picker) in place, with a back row.
 */

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect?: () => void | Promise<void>
  danger?: boolean
  /** Ask for a second click, showing this text first (for deletes) */
  confirm?: string
  checked?: boolean
  children?: MenuEntry[]
  panel?: () => ReactNode
}
export type MenuEntry = MenuItem | 'separator'

interface View {
  title?: string
  entries?: MenuEntry[]
  panel?: () => ReactNode
}

interface MenuState {
  pos: { x: number; y: number } | null
  stack: View[]
  open: (pos: { x: number; y: number }, view: View) => void
  push: (view: View) => void
  pop: () => void
  close: () => void
}

const useMenu = create<MenuState>((set) => ({
  pos: null,
  stack: [],
  open: (pos, view) => set({ pos, stack: [view] }),
  push: (view) => set((s) => ({ stack: [...s.stack, view] })),
  pop: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : { pos: null, stack: [] })),
  close: () => set({ pos: null, stack: [] })
}))

type Point = { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }

/** Opens the menu at the mouse (for onContextMenu) with these entries. */
export function openMenu(e: Point, entries: MenuEntry[]): void {
  e.preventDefault?.()
  e.stopPropagation?.()
  useMenu.getState().open({ x: e.clientX, y: e.clientY }, { entries })
}

/** Opens a panel directly (e.g. clicking a note's icon opens the icon picker under it). */
export function openPanel(anchor: HTMLElement, title: string, panel: () => ReactNode): void {
  const r = anchor.getBoundingClientRect()
  useMenu.getState().open({ x: r.left, y: r.bottom + 4 }, { title, panel })
}

export const closeMenu = (): void => useMenu.getState().close()

export function ContextMenuHost() {
  const { pos, stack, push, pop, close } = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const [armed, setArmed] = useState<number | null>(null)
  const [focus, setFocus] = useState(-1)
  const view = stack[stack.length - 1]

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!pos || !ref.current) return setPlace(null)
    const { width, height } = ref.current.getBoundingClientRect()
    setPlace({ left: Math.max(6, Math.min(pos.x, window.innerWidth - width - 6)), top: Math.max(6, Math.min(pos.y, window.innerHeight - height - 6)) })
  }, [pos, view])

  useEffect(() => {
    setArmed(null)
    setFocus(-1)
    if (view?.entries) ref.current?.focus()
  }, [view])

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onBlur = (): void => close()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || ref.current?.contains(document.activeElement)) return // the menu handles its own keys
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [pos, close])

  if (!pos || !view) return null
  const items = (view.entries ?? []).map((e, i) => ({ e, i })).filter((x): x is { e: MenuItem; i: number } => x.e !== 'separator')

  const choose = (item: MenuItem, index: number): void => {
    if (item.children) return push({ title: item.label, entries: item.children })
    if (item.panel) return push({ title: item.label, panel: item.panel })
    if (item.confirm && armed !== index) return setArmed(index)
    close()
    void item.onSelect?.()
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      style={place ?? { left: pos.x, top: pos.y, visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          return close()
        }
        if (e.key === 'ArrowLeft' && stack.length > 1 && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault()
          return pop()
        }
        if (!view.entries) return
        const at = items.findIndex((x) => x.i === focus)
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          setFocus(items[next]?.i ?? -1)
        } else if ((e.key === 'Enter' || e.key === 'ArrowRight') && at >= 0) {
          e.preventDefault()
          choose(items[at].e, items[at].i)
        }
      }}
    >
      {stack.length > 1 && (
        <button type="button" className="ctx-back" onClick={pop}>
          <ChevronLeft /> {view.title}
        </button>
      )}
      {view.panel
        ? view.panel()
        : view.entries!.map((entry, i) =>
            entry === 'separator' ? (
              <div key={`sep${i}`} className="ctx-sep" />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                className={`ctx-item ${entry.danger ? 'danger' : ''} ${focus === i ? 'focused' : ''}`}
                onMouseEnter={() => setFocus(i)}
                onClick={() => choose(entry, i)}
              >
                <span className="ctx-icon">{entry.checked ? <Check /> : entry.icon}</span>
                <span className="ctx-label">{armed === i ? entry.confirm : entry.label}</span>
                {(entry.children || entry.panel) && <ChevronRight className="ctx-more" />}
              </button>
            )
          )}
    </div>
  )
}

/** Icon + colour chooser (used in the menu and from a note's icon). Changes apply immediately. */
export function IconPicker({ icon, color, onChange }: { icon: string; color: string; onChange: (style: { icon: string; color: string }) => void }) {
  const [value, setValue] = useState({ icon, color })
  const isEmoji = value.icon !== '' && !ICONS[value.icon]
  const [emoji, setEmoji] = useState(isEmoji ? value.icon : '')
  const apply = (next: { icon: string; color: string }): void => {
    setValue(next)
    onChange(next)
  }
  return (
    <div className="icon-picker">
      <div className="swatches" role="radiogroup" aria-label="Colour">
        <button
          type="button"
          role="radio"
          aria-checked={value.color === ''}
          aria-label="Default colour"
          title="Default"
          className={`swatch swatch-default ${value.color === '' ? 'on' : ''}`}
          onClick={() => apply({ ...value, color: '' })}
        />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.color === c}
            aria-label={c}
            title={c[0].toUpperCase() + c.slice(1)}
            className={`swatch ${value.color === c ? 'on' : ''}`}
            style={{ background: `var(--c-${c})` }}
            onClick={() => apply({ ...value, color: c })}
          />
        ))}
      </div>
      <div className="icon-grid">
        {Object.entries(ICONS).map(([name, Icon]) => (
          <button
            key={name}
            type="button"
            title={name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')}
            aria-label={`Icon ${name}`}
            className={`icon-choice ${value.icon === name ? 'on' : ''}`}
            onClick={() => apply({ ...value, icon: name })}
          >
            <Icon style={colorStyle(value.color)} />
          </button>
        ))}
      </div>
      <div className="icon-picker-foot">
        <input
          value={emoji}
          placeholder="Or an emoji (Win + .)"
          aria-label="Emoji icon"
          onChange={(e) => {
            const v = [...e.target.value.trim()].slice(-8).join('')
            setEmoji(v)
            if (v) apply({ ...value, icon: v })
          }}
        />
        <button type="button" className="btn sm" title="Back to the default icon and colour" onClick={() => (setEmoji(''), apply({ icon: '', color: '' }))}>
          <RotateCcw /> Reset
        </button>
      </div>
    </div>
  )
}
