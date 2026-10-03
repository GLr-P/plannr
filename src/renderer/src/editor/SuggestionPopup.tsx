import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'

/** One row in a popup menu (slash commands, @-mentions). `value` is passed back to the command. */
export interface MenuItem<V = unknown> {
  key: string
  label: string
  hint?: string
  icon?: ReactNode
  value: V
}

interface ListProps {
  items: MenuItem[]
  command: (value: unknown) => void
  emptyText?: string
}

interface ListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const SuggestionList = forwardRef<ListHandle, ListProps>(function SuggestionList({ items, command, emptyText }, ref) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [items])
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event) => {
        if (!items.length) return false
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          command(items[selected].value)
          return true
        }
        return false
      }
    }),
    [items, selected, command]
  )

  return (
    <div className="menu" ref={listRef} role="listbox">
      {items.length === 0 && <div className="menu-empty">{emptyText ?? 'No results'}</div>}
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          className="menu-item"
          data-selected={i === selected}
          onMouseEnter={() => setSelected(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            command(item.value)
          }}
        >
          {item.icon && <span className="menu-icon">{item.icon}</span>}
          <span className="menu-label">{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
})

/** TipTap suggestion `render` that shows a SuggestionList under the cursor. */
export function popupRenderer<V>(emptyText?: string): SuggestionOptions<MenuItem<V>, V>['render'] {
  return () => {
    let renderer: ReactRenderer<ListHandle, ListProps> | null = null
    let hidden = false

    const place = (props: SuggestionProps<MenuItem<V>, V>): void => {
      const el = renderer?.element as HTMLElement | undefined
      const rect = props.clientRect?.()
      if (!el || !rect) return
      el.style.display = hidden ? 'none' : ''
      const below = rect.bottom + 6
      const height = el.offsetHeight
      el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 12))}px`
      el.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below}px`
    }
    const listProps = (props: SuggestionProps<MenuItem<V>, V>): ListProps => ({
      items: props.items as MenuItem[],
      command: props.command as (value: unknown) => void,
      emptyText
    })

    return {
      onStart: (props) => {
        hidden = false
        renderer = new ReactRenderer(SuggestionList, { props: listProps(props), editor: props.editor })
        const el = renderer.element as HTMLElement
        el.classList.add('suggest-popup')
        document.body.appendChild(el)
        place(props)
        requestAnimationFrame(() => place(props))
      },
      onUpdate: (props) => {
        renderer?.updateProps(listProps(props))
        place(props)
        requestAnimationFrame(() => place(props))
      },
      onKeyDown: ({ event }) => {
        if (event.key === 'Escape') {
          hidden = true
          const el = renderer?.element as HTMLElement | undefined
          if (el) el.style.display = 'none'
          return true
        }
        if (hidden) return false
        return renderer?.ref?.onKeyDown(event) ?? false
      },
      onExit: () => {
        ;(renderer?.element as HTMLElement | undefined)?.remove()
        renderer?.destroy()
        renderer = null
      }
    }
  }
}
