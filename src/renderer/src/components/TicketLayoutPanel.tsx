import { useState } from 'react'
import { PanelTop } from 'lucide-react'
import { ticketLayout, type TicketLayout } from '../../../shared/api'

type BoolKey = { [K in keyof TicketLayout]: TicketLayout[K] extends boolean ? K : never }[keyof TicketLayout]
type TextKey = { [K in keyof TicketLayout]: TicketLayout[K] extends string ? K : never }[keyof TicketLayout]

/**
 * A ticket template's "Top of the ticket": what the title and summary boxes are called and which built-in parts
 * (customer, dates, price, line items, photos, emails) its tickets show. Hidden parts can still go in the form
 * itself, e.g. "/Customer details".
 */
export function TicketLayoutPanel({ layout: saved, onChange }: { layout: Partial<TicketLayout> | null; onChange: (layout: Partial<TicketLayout>) => void }) {
  const [layout, setLayout] = useState<TicketLayout>(() => ticketLayout(saved))
  const set = (patch: Partial<TicketLayout>): void => {
    const next = { ...layout, ...patch }
    setLayout(next)
    onChange(next)
  }
  const text = (key: TextKey, label: string, placeholder?: string) => (
    <label className="layout-text">
      <span>{label}</span>
      <input value={layout[key]} placeholder={placeholder} aria-label={label} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  )
  const check = (key: BoolKey, label: string, extra?: React.ReactNode) => (
    <div className="layout-check">
      <label className="check">
        <input type="checkbox" checked={layout[key]} aria-label={label} onChange={(e) => set({ [key]: e.target.checked })} />
        {label}
      </label>
      {layout[key] && extra}
    </div>
  )

  return (
    <details className="layout-panel">
      <summary>
        <PanelTop /> Top of the ticket
        <span className="muted"> · what the title is called and which parts show (customer, dates, price, photos…)</span>
      </summary>
      <div className="layout-grid">
        <div className="layout-group">
          <h4>Title box</h4>
          {text('titleLabel', 'Name', 'Title')}
          {text('titlePlaceholder', 'Example text', 'e.g. Anniversary bouquet')}
        </div>
        <div className="layout-group">
          <h4>Line under the title</h4>
          {check('showSummary', 'Show it')}
          {layout.showSummary && (
            <>
              {text('summaryLabel', 'Name', 'Details')}
              {text('summaryPlaceholder', 'Example text', 'A short description')}
            </>
          )}
        </div>
        <div className="layout-group">
          <h4>Show at the top</h4>
          {check(
            'showCustomer',
            'Customer',
            <div className="layout-sub">
              {check('showCustomerPhone', 'Phone')}
              {check('showCustomerEmail', 'Email')}
            </div>
          )}
          {check('showReceived', 'First date', text('receivedLabel', 'Called', 'Received'))}
          {check('showPickup', 'Second date (goes on the calendar)', text('pickupLabel', 'Called', 'Pickup'))}
          {check('showPrice', 'Price and payments')}
          {check('showLines', 'Quote & invoice lines')}
          {check('showPhotos', 'Photos')}
          {check('showEmails', 'Emails with the customer')}
        </div>
      </div>
      <p className="muted small">
        Hidden parts can go inside the form instead: type <kbd>/</kbd> → <strong>Customer details</strong> or <strong>Ticket dates</strong>.
      </p>
    </details>
  )
}
