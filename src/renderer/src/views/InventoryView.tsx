import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus, Search, X } from 'lucide-react'
import type { Part, PartInput } from '../../../shared/api'
import { api } from '../api'
import { formatMoney, parseMoney } from '../lib/format'
import { ConfirmButton } from '../components/common'
import { undoToast } from '../lib/toast'
import { useData } from '../store/data'
import { useSyncedFields } from '../lib/useSyncedFields'

/** Parts inventory: what's in stock, what it costs, what you sell it for, and what's running low. */
export function InventoryView() {
  const [parts, setParts] = useState<Part[]>([])
  const [query, setQuery] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const load = useCallback(async () => {
    setParts(await api.parts.list({ query, lowOnly }))
    void useData.getState().refreshCounts()
  }, [query, lowOnly])
  const remote = useData((s) => s.remote) // changed on another device
  useEffect(() => {
    const t = setTimeout(() => void load(), 60)
    return () => clearTimeout(t)
  }, [load, remote])

  const value = parts.reduce((s, p) => s + Math.max(0, p.qty) * p.costCents, 0)
  const low = parts.filter((p) => p.reorderAt > 0 && p.qty <= p.reorderAt).length

  return (
    <div className="page list-page wide-page">
      <div className="list-header">
        <h1>Inventory</h1>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            const p = await api.parts.create({ name: '' })
            setQuery('')
            setLowOnly(false)
            setFocusId(p.id)
            await load()
          }}
        >
          <Plus /> New part
        </button>
      </div>
      <div className="tx-toolbar">
        <div className="filter-field grow">
          <Search />
          <input placeholder="Search parts, SKU, supplier…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search parts" />
          {query && (
            <button type="button" className="icon-btn sm" aria-label="Clear search" onClick={() => setQuery('')}>
              <X />
            </button>
          )}
        </div>
        <button type="button" className={`chip-btn ${lowOnly ? 'active' : ''}`} onClick={() => setLowOnly(!lowOnly)}>
          Running low
        </button>
      </div>
      <div className="tx-totals">
        <span>
          {parts.length} {parts.length === 1 ? 'part' : 'parts'}
        </span>
        <span>
          Stock value <strong>{formatMoney(value)}</strong>
        </span>
        {low > 0 && (
          <span className="low-note">
            <AlertTriangle /> {low} running low
          </span>
        )}
      </div>
      {parts.length === 0 ? (
        <div className="empty-state">
          {query || lowOnly ? 'No parts match.' : 'No parts yet. Add the parts you keep in stock; using one on a ticket takes it off stock.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table parts-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>SKU</th>
                <th className="num">In stock</th>
                <th className="num">Reorder at</th>
                <th className="num">Cost</th>
                <th className="num">Price</th>
                <th>Supplier</th>
                <th className="num">Used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <PartRow key={p.id} part={p} autoFocus={p.id === focusId} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PartRow({ part, autoFocus, onSaved }: { part: Part; autoFocus: boolean; onSaved: () => Promise<void> }) {
  const [v, patchV] = useSyncedFields({
    name: part.name,
    sku: part.sku,
    qty: String(part.qty),
    reorderAt: String(part.reorderAt),
    cost: formatMoney(part.costCents),
    price: formatMoney(part.priceCents),
    supplier: part.supplier
  })
  const setV = (next: typeof v): void => patchV(next)
  const save = async (patch: PartInput): Promise<void> => {
    await api.parts.update(part.id, patch)
    await onSaved()
  }
  const low = part.reorderAt > 0 && part.qty <= part.reorderAt
  const text = (key: 'name' | 'sku' | 'supplier', label: string, placeholder = '') => (
    <input
      value={v[key]}
      placeholder={placeholder}
      aria-label={label}
      autoFocus={key === 'name' && autoFocus}
      onChange={(e) => setV({ ...v, [key]: e.target.value })}
      onBlur={() => v[key] !== part[key] && void save({ [key]: v[key] })}
    />
  )
  const num = (key: 'qty' | 'reorderAt', label: string) => (
    <input
      className="cell-num"
      value={v[key]}
      inputMode="decimal"
      aria-label={label}
      onChange={(e) => setV({ ...v, [key]: e.target.value })}
      onBlur={() => {
        const n = Number(v[key])
        if (Number.isFinite(n) && n !== part[key]) void save({ [key]: n })
        else setV({ ...v, [key]: String(part[key]) })
      }}
    />
  )
  const money = (key: 'cost' | 'price', field: 'costCents' | 'priceCents', label: string) => (
    <input
      className="cell-num"
      value={v[key]}
      inputMode="decimal"
      placeholder="$0.00"
      aria-label={label}
      onChange={(e) => setV({ ...v, [key]: e.target.value })}
      onBlur={() => {
        const cents = parseMoney(v[key]) ?? 0
        setV({ ...v, [key]: formatMoney(cents) })
        if (cents !== part[field]) void save({ [field]: cents })
      }}
    />
  )
  return (
    <tr className={`part-row ${low ? 'low' : ''}`}>
      <td>{text('name', 'Part name', 'Part name')}</td>
      <td>{text('sku', 'SKU')}</td>
      <td className="num">
        {low && <AlertTriangle className="low-icon" aria-label="Running low" />}
        {num('qty', 'In stock')}
      </td>
      <td className="num">{num('reorderAt', 'Reorder at')}</td>
      <td className="num">{money('cost', 'costCents', 'Cost')}</td>
      <td className="num">{money('price', 'priceCents', 'Selling price')}</td>
      <td>{text('supplier', 'Supplier')}</td>
      <td className="num muted">{part.used || ''}</td>
      <td className="num">
        <span className="row-actions">
          <ConfirmButton
            title="Delete part"
            onConfirm={async () => {
              await api.parts.remove(part.id)
              await onSaved()
              undoToast(`${part.name || 'Part'} deleted`, async () => {
                await api.parts.restore(part.id)
                await onSaved()
              })
            }}
          />
        </span>
      </td>
    </tr>
  )
}
