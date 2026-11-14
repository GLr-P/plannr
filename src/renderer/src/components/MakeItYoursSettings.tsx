import { useEffect, useState } from 'react'
import { Eye, FileText, Plus, Tag, Trash2 } from 'lucide-react'
import { CUSTOMER_FIELD_KINDS, CUSTOMER_PARTS, type CustomerFieldDef } from '../../../shared/api'
import { allSections } from '../../../shared/ticket-sections'
import { ICONS } from '../lib/icons'
import { useSections } from '../store/sections'
import { useCustomerLayout } from '../store/customerLayout'

/**
 * Settings → Tickets: your sections and your customer page setup, listed in one place. The same things are
 * changed where they show (a section's ⋯ menu and + Add on a ticket; Customize on a customer page).
 */
export function SectionSettings() {
  const { lib, load, remove, setHidden } = useSections()
  useEffect(() => void load(), [load])
  const sections = allSections(lib, true)
  const mine = sections.filter((s) => s.mine || s.changed)
  const hidden = sections.filter((s) => s.hidden)
  return (
    <section className="setting setting-stack">
      <div>
        <h3>Ticket sections</h3>
        <p className="muted">
          Make a section on any ticket (+ Add → New section), then use its ⋯ menu to save it here. Built-in sections can be hidden from + Add.
        </p>
      </div>
      {mine.length === 0 && hidden.length === 0 && <p className="small muted">Nothing saved or hidden yet.</p>}
      {mine.length > 0 && (
        <ul className="plain-list">
          {mine.map((s) => {
            const Icon = ICONS[s.icon] ?? FileText
            return (
              <li key={s.id} className="plain-row">
                <Icon className="row-icon" />
                <span className="grow">
                  {s.title} {s.changed && <span className="muted small">(your version of a built-in one)</span>}
                </span>
                <DeleteButton label={s.changed ? `Go back to the built-in “${s.title}”` : `Delete “${s.title}”`} onDelete={() => void remove(s.id)} />
              </li>
            )
          })}
        </ul>
      )}
      {hidden.length > 0 && (
        <div className="chip-row">
          <span className="muted small">Hidden from + Add:</span>
          {hidden.map((s) => (
            <button key={s.id} type="button" className="chip" title="Show it in + Add again" onClick={() => void setHidden(s.id, false)}>
              <Eye /> {s.title}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function CustomerPageSettings() {
  const { layout, load, save } = useCustomerLayout()
  useEffect(() => void load(), [load])
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<CustomerFieldDef['kind']>('text')
  const add = (): void => {
    if (!label.trim()) return
    void save({ fields: [...layout.fields, { id: `f_${Date.now().toString(36)}`, label: label.trim(), kind }] })
    setLabel('')
  }
  return (
    <section className="setting setting-stack">
      <div>
        <h3>Customer pages</h3>
        <p className="muted">Your own fields and what shows, for every customer. Also changeable with Customize on any customer page.</p>
      </div>
      {layout.fields.length > 0 && (
        <ul className="plain-list">
          {layout.fields.map((f) => (
            <li key={f.id} className="plain-row">
              <Tag className="row-icon" />
              <span className="grow">
                {f.label} <span className="muted small">{CUSTOMER_FIELD_KINDS.find((k) => k.id === f.kind)?.label}</span>
              </span>
              <DeleteButton label={`Delete “${f.label}” from every customer`} onDelete={() => void save({ fields: layout.fields.filter((x) => x.id !== f.id) })} />
            </li>
          ))}
        </ul>
      )}
      <div className="chip-row">
        <input className="setting-input" value={label} placeholder="New field, e.g. Birthday" aria-label="New customer field" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="setting-input" value={kind} aria-label="Field type" onChange={(e) => setKind(e.target.value as CustomerFieldDef['kind'])}>
          {CUSTOMER_FIELD_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn sm" disabled={!label.trim()} onClick={add}>
          <Plus /> Add field
        </button>
      </div>
      <div className="chip-row">
        <span className="muted small">Shown on customer pages:</span>
        {CUSTOMER_PARTS.map((p) => {
          const on = !layout.hidden.includes(p.id)
          return (
            <label key={p.id} className="check-row">
              <input type="checkbox" checked={on} onChange={() => void save({ hidden: on ? [...layout.hidden, p.id] : layout.hidden.filter((h) => h !== p.id) })} />
              {layout.labels[p.id] || p.label}
            </label>
          )
        })}
      </div>
    </section>
  )
}

function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      className={`icon-btn sm ${armed ? 'danger' : ''}`}
      aria-label={label}
      title={armed ? 'Click again to confirm' : label}
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      <Trash2 />
    </button>
  )
}
