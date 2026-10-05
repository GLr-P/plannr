import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { TICKET_STATUSES, formatTicketNumber } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { saveDisplay, useDisplay } from '../store/display'
import { ACCENTS, TEXT_SIZES } from '../lib/appearance'
import { HIDEABLE, navHidden } from '../lib/navOrder'
import { HOME_SECTIONS, hiddenList, homeOrder, type HomeSection } from '../lib/homeSections'

/* Settings sections for customizing Plannr: look, menu, Home, tickets and money display. */

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Accent colour, spacing and text size (shown under the theme choice). */
export function LookSettings() {
  const accent = useUi((s) => s.prefs.accent) ?? 'blue'
  const density = (useUi((s) => s.prefs.density) ?? 'comfortable') as 'comfortable' | 'compact'
  const setPref = useUi((s) => s.setPref)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    void api.app.getZoom().then(setZoom)
  }, [])
  return (
    <>
      <section className="setting">
        <div>
          <h3>Accent colour</h3>
          <p className="muted">Buttons, links, selections and highlights.</p>
        </div>
        <div className="accent-swatches" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={accent === a.id}
              aria-label={a.label}
              title={a.label}
              className={`accent-swatch ${accent === a.id ? 'on' : ''}`}
              style={{ background: a.color }}
              onClick={() => setPref('accent', a.id)}
            />
          ))}
        </div>
      </section>
      <section className="setting">
        <div>
          <h3>Spacing</h3>
          <p className="muted">Compact fits more on screen.</p>
        </div>
        <Segmented
          label="Spacing"
          value={density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' }
          ]}
          onChange={(v) => setPref('density', v)}
        />
      </section>
      <section className="setting">
        <div>
          <h3>Text size</h3>
          <p className="muted">Makes everything bigger or smaller.</p>
        </div>
        <Segmented
          label="Text size"
          value={TEXT_SIZES.find((t) => Math.abs(t.value - zoom) < 0.01)?.value ?? 1}
          options={TEXT_SIZES.map((t) => ({ value: t.value, label: t.label }))}
          onChange={(v) => {
            setZoom(v)
            void api.app.setZoom(v)
          }}
        />
      </section>
    </>
  )
}

/** Which menu items show in the sidebar. */
export function MenuSettings() {
  const hiddenPref = useUi((s) => s.prefs.navHidden)
  const setPref = useUi((s) => s.setPref)
  const hidden = navHidden(hiddenPref)
  const toggle = (id: string, show: boolean): void =>
    setPref('navHidden', (show ? hidden.filter((h) => h !== id) : [...hidden, id]).join(','))
  return (
    <section className="setting setting-stack">
      <div>
        <h3>Menu</h3>
        <p className="muted">Untick what you don’t use. Drag items in the sidebar to reorder them.</p>
      </div>
      <div className="check-grid">
        {HIDEABLE.map((item) => (
          <label key={item.id} className="check-row">
            <input type="checkbox" checked={!hidden.includes(item.id)} onChange={(e) => toggle(item.id, e.target.checked)} />
            {item.label}
          </label>
        ))}
      </div>
    </section>
  )
}

/** Home page sections: show/hide and order. */
export function HomeLayoutSettings() {
  const orderPref = useUi((s) => s.prefs.homeOrder)
  const hiddenPref = useUi((s) => s.prefs.homeHidden)
  const setPref = useUi((s) => s.setPref)
  const order = homeOrder(orderPref)
  const hidden = hiddenList(hiddenPref)
  const move = (id: HomeSection, by: number): void => {
    const next = [...order]
    const at = next.indexOf(id)
    next.splice(at, 1)
    next.splice(Math.max(0, Math.min(next.length, at + by)), 0, id)
    setPref('homeOrder', next.join(','))
  }
  return (
    <section className="setting setting-stack">
      <div>
        <h3>Home page</h3>
        <p className="muted">Choose what Home shows, and in what order.</p>
      </div>
      <ul className="order-list">
        {order.map((id, i) => (
          <li key={id}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!hidden.includes(id)}
                onChange={(e) => setPref('homeHidden', (e.target.checked ? hidden.filter((h) => h !== id) : [...hidden, id]).join(','))}
              />
              {HOME_SECTIONS.find((s) => s.id === id)?.label}
            </label>
            <span className="order-buttons">
              <button type="button" className="icon-btn sm" aria-label={`Move ${id} up`} disabled={i === 0} onClick={() => move(id, -1)}>
                <ArrowUp />
              </button>
              <button type="button" className="icon-btn sm" aria-label={`Move ${id} down`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                <ArrowDown />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function WeekStartSetting() {
  const weekStart = useDisplay((s) => s.prefs.weekStart)
  return (
    <section className="setting">
      <div>
        <h3>Week starts on</h3>
        <p className="muted">For the calendar.</p>
      </div>
      <Segmented
        label="Week starts on"
        value={weekStart}
        options={[
          { value: 0, label: 'Sunday' },
          { value: 1, label: 'Monday' }
        ]}
        onChange={(v) => void saveDisplay({ weekStart: v as 0 | 1 })}
      />
    </section>
  )
}

/** Ticket number prefix and your names for the statuses. */
export function TicketSettings() {
  const prefs = useDisplay((s) => s.prefs)
  const [prefix, setPrefix] = useState(prefs.ticketPrefix)
  const [labels, setLabels] = useState<Record<string, string>>({ ...prefs.statusLabels })
  return (
    <>
      <section className="setting">
        <div>
          <h3>Ticket numbers</h3>
          <p className="muted">
            Letters before the number. Tickets will look like <strong>{formatTicketNumber(7)}</strong>.
          </p>
        </div>
        <input
          className="setting-input"
          value={prefix}
          maxLength={8}
          aria-label="Ticket number prefix"
          onChange={(e) => setPrefix(e.target.value)}
          onBlur={() => void saveDisplay({ ticketPrefix: prefix })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </section>
      <section className="setting setting-stack">
        <div>
          <h3>Status names</h3>
          <p className="muted">Rename the steps a repair goes through. Leave blank for the standard name.</p>
        </div>
        <div className="status-names">
          {TICKET_STATUSES.map((s) => (
            <label key={s.id} className="mfield">
              <span className={`status status-${s.id}`}>{s.label}</span>
              <input
                value={labels[s.id] ?? ''}
                placeholder={s.label}
                aria-label={`Name for ${s.label}`}
                onChange={(e) => setLabels({ ...labels, [s.id]: e.target.value })}
                onBlur={() => void saveDisplay({ statusLabels: labels })}
              />
            </label>
          ))}
        </div>
      </section>
    </>
  )
}

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'INR', 'JPY', 'CHF']

/** Currency and payment methods (Business tab). */
export function MoneyDisplaySettings() {
  const prefs = useDisplay((s) => s.prefs)
  const [methods, setMethods] = useState(prefs.paymentMethods.join('\n'))
  return (
    <>
      <section className="setting">
        <div>
          <h3>Currency</h3>
          <p className="muted">For prices, payments and receipts.</p>
        </div>
        <select className="setting-input" value={prefs.currency} aria-label="Currency" onChange={(e) => void saveDisplay({ currency: e.target.value })}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </section>
      <section className="setting setting-stack">
        <div>
          <h3>Payment methods</h3>
          <p className="muted">One per line. These are the choices when you record a payment or expense.</p>
        </div>
        <textarea
          className="setting-textarea"
          rows={6}
          value={methods}
          aria-label="Payment methods"
          onChange={(e) => setMethods(e.target.value)}
          onBlur={() => void saveDisplay({ paymentMethods: methods.split('\n') })}
        />
      </section>
    </>
  )
}
