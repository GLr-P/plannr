import { useCallback, useEffect, useState } from 'react'
import { Package, Plus, Trash2 } from 'lucide-react'
import { lineTotal, type LineItem, type LineKind, type Part, type TicketTotals } from '../../../shared/api'
import { api } from '../api'
import { formatMoney, parseMoney } from '../lib/format'
import { useData } from '../store/data'
import { useSyncedFields } from '../lib/useSyncedFields'

const KINDS: { id: LineKind; label: string }[] = [
  { id: 'labour', label: 'Labour' },
  { id: 'part', label: 'Part' },
  { id: 'other', label: 'Other' },
  { id: 'discount', label: 'Discount' }
]

/**
 * Quote / invoice lines on a ticket. Part lines can come from the inventory (stock follows).
 * The ticket's price follows the total; \`onTotal\` tells the page (null = no lines, price is typed by hand).
 */
export function TicketLines({ ticketId, taxExempt, readOnly, onTotal, onTaxExempt }: {
  ticketId: string
  taxExempt: boolean
  readOnly: boolean
  onTotal: (cents: number | null) => void
  onTaxExempt: (exempt: boolean) => void
}) {
  const [items, setItems] = useState<LineItem[] | null>(null)
  const [totals, setTotals] = useState<TicketTotals | null>(null)
  const [parts, setParts] = useState<Part[]>([])
  const [taxName, setTaxName] = useState('Tax')
  const [taxRate, setTaxRate] = useState(0)

  const refresh = useCallback(
    async (list?: LineItem[]) => {
      const next = list ?? (await api.tickets.items(ticketId))
      setItems(next)
      const t = await api.tickets.totals(ticketId)
      setTotals(t)
      onTotal(next.length ? t.total : null)
      if (list) void useData.getState().refreshCounts() // stock may have changed (the "running low" count)
    },
    [ticketId, onTotal]
  )

  useEffect(() => {
    void refresh()
    void api.parts.list().then(setParts)
    void api.business.get().then((b) => setTaxName(b.taxName || 'Tax'))
  }, [refresh])
  useEffect(() => {
    void Promise.all([api.business.get(), api.quickbooks.status()]).then(([b, q]) => setTaxRate(b.taxRate || q.config?.taxRate || 0))
  }, [])
  useEffect(() => {
    if (items) void refresh(items) // the tax changed
  }, [taxExempt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!items) return null
  const add = async (kind: LineKind): Promise<void> => refresh(await api.tickets.addItem(ticketId, { kind, qty: 1 }))
  const update = async (id: string, patch: Parameters<typeof api.tickets.updateItem>[1]): Promise<void> => {
    await refresh(await api.tickets.updateItem(id, patch))
    if (patch.partId !== undefined || patch.qty !== undefined) void api.parts.list().then(setParts) // stock changed
  }
  const remove = async (id: string): Promise<void> => {
    await refresh(await api.tickets.removeItem(id))
    void api.parts.list().then(setParts)
  }

  if (!items.length) {
    return (
      <section className="ticket-lines empty">
        <span className="vault-field-label">Quote &amp; invoice</span>
        {!readOnly && (
          <button type="button" className="btn sm" onClick={() => void add('labour')}>
            <Plus /> Add line items
          </button>
        )}
        <span className="small muted">Parts, labour and discounts, with tax. Print as a quote or an invoice.</span>
      </section>
    )
  }

  return (
    <section className="ticket-lines">
      <div className="ticket-lines-head">
        <span className="vault-field-label">Quote &amp; invoice</span>
      </div>
      <datalist id="inventory-parts">
        {parts.map((p) => (
          <option key={p.id} value={p.name}>
            {`${p.qty} in stock · ${formatMoney(p.priceCents)}`}
          </option>
        ))}
      </datalist>
      <table className="lines-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <LineRow key={l.id} line={l} parts={parts} readOnly={readOnly} onChange={(patch) => void update(l.id, patch)} onRemove={() => void remove(l.id)} />
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="lines-add">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="btn sm" onClick={() => void add(k.id)}>
              <Plus /> {k.label}
            </button>
          ))}
        </div>
      )}
      {totals && (
        <div className="lines-totals">
          {totals.discount > 0 && (
            <>
              <span>Subtotal</span>
              <span className="num">{formatMoney(totals.subtotal)}</span>
              <span>Discount</span>
              <span className="num">−{formatMoney(totals.discount)}</span>
            </>
          )}
          <span>
            {taxName}
            {taxRate && !taxExempt ? ` (${taxRate}%)` : ''}
            {!readOnly && (
              <label className="check-row inline">
                <input type="checkbox" checked={taxExempt} onChange={(e) => onTaxExempt(e.target.checked)} aria-label="No tax" /> No tax
              </label>
            )}
          </span>
          <span className="num">{formatMoney(totals.tax)}</span>
          <span className="lines-total-label">Total</span>
          <span className="num lines-total">{formatMoney(totals.total)}</span>
          {totals.cost > 0 && (
            <span className="lines-profit">
              Parts cost {formatMoney(totals.cost)} · profit {formatMoney(totals.profit)} (only you see this)
            </span>
          )}
        </div>
      )}
    </section>
  )
}

function LineRow({ line, parts, readOnly, onChange, onRemove }: {
  line: LineItem
  parts: Part[]
  readOnly: boolean
  onChange: (patch: { kind?: LineKind; description?: string; qty?: number; unitCents?: number; partId?: string | null }) => void
  onRemove: () => void
}) {
  const [f, patch] = useSyncedFields({ description: line.description, qty: String(line.qty), price: formatMoney(line.unitCents) })
  const { description, qty, price } = f
  const setDescription = (description: string): void => patch({ description })
  const setQty = (qty: string): void => patch({ qty })
  const setPrice = (price: string): void => patch({ price })
  const part = line.partId ? parts.find((p) => p.id === line.partId) : undefined
  const isDiscount = line.kind === 'discount'

  return (
    <tr>
      <td>
        <select value={line.kind} disabled={readOnly} aria-label="Line type" onChange={(e) => onChange({ kind: e.target.value as LineKind })}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="line-desc">
          {part && <Package className="line-part-icon" aria-label="From inventory" />}
          <input
            value={description}
            readOnly={readOnly}
            list={line.kind === 'part' ? 'inventory-parts' : undefined}
            placeholder={line.kind === 'part' ? 'Part (pick from inventory or type)' : isDiscount ? 'Reason (optional)' : 'What was done'}
            aria-label="Description"
            onChange={(e) => {
              setDescription(e.target.value)
              // Picking a part from the list links it (stock and cost follow).
              const match = line.kind === 'part' ? parts.find((p) => p.name === e.target.value) : undefined
              if (match && match.id !== line.partId) onChange({ partId: match.id })
            }}
            onBlur={() => description !== line.description && onChange({ description })}
          />
        </div>
        {part && <div className="line-stock small muted">{part.qty} left in stock</div>}
      </td>
      <td className="num">
        {!isDiscount && (
          <input
            className="line-qty"
            value={qty}
            readOnly={readOnly}
            inputMode="decimal"
            aria-label="Quantity"
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => {
              const n = Number(qty)
              if (Number.isFinite(n) && n !== line.qty) onChange({ qty: n })
              else setQty(String(line.qty))
            }}
          />
        )}
      </td>
      <td className="num">
        <input
          className="line-price"
          value={price}
          readOnly={readOnly}
          inputMode="decimal"
          aria-label={isDiscount ? 'Discount amount' : 'Unit price'}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => {
            const cents = parseMoney(price) ?? 0
            setPrice(formatMoney(cents))
            if (cents !== line.unitCents) onChange({ unitCents: cents })
          }}
        />
      </td>
      <td className="num line-amount">{isDiscount ? `−${formatMoney(lineTotal(line))}` : formatMoney(lineTotal(line))}</td>
      <td>
        {!readOnly && (
          <button type="button" className="icon-btn sm" aria-label="Remove line" title="Remove line" onClick={onRemove}>
            <Trash2 />
          </button>
        )}
      </td>
    </tr>
  )
}
