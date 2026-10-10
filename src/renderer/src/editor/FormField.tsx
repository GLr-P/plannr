import { useEffect, useId, useState } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { GripVertical, Link2, Settings2 } from 'lucide-react'
import { formatCurrency, type CustomerSummary, type DocJSON } from '../../../shared/api'
import { collectFields, evaluateFormula, formatCalc, formulaRefs, type FormValue } from '../../../shared/formula'
import { api } from '../api'
import { FIELD_LINKS, linkDef, useFormLinks } from './formLinks'

export const FIELD_KINDS = [
  { id: 'text', label: 'Short text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'money', label: 'Money' },
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'select', label: 'Dropdown' },
  { id: 'choice', label: 'Pick one (buttons)' },
  { id: 'multi', label: 'Pick several' },
  { id: 'calc', label: 'Calculated' }
] as const
type FieldKind = (typeof FIELD_KINDS)[number]['id']

const WIDTHS = [
  { id: 'full', label: 'Full' },
  { id: 'half', label: 'Half' },
  { id: 'third', label: 'Third' },
  { id: 'small', label: 'Small' }
] as const
const LABEL_POSITIONS = [
  { id: 'left', label: 'Left' },
  { id: 'top', label: 'Above' },
  { id: 'hidden', label: 'Hidden' }
] as const
const HEIGHTS = [
  { id: 2, label: 'Short' },
  { id: 4, label: 'Medium' },
  { id: 8, label: 'Tall' }
] as const
const WITH_CHOICES: string[] = ['select', 'choice', 'multi']
const WITH_PLACEHOLDER: string[] = ['text', 'textarea', 'number', 'money', 'phone', 'email']

export interface FieldAttrs {
  label: string
  kind: FieldKind
  options: string[]
  value: string
  /** How much of the line the field takes: full (one per line), half/third (side by side), small (fits in a sentence) */
  width: (typeof WIDTHS)[number]['id']
  labelPos: (typeof LABEL_POSITIONS)[number]['id']
  placeholder: string
  /** Small text under the box */
  hint: string
  /** Long text: lines tall */
  rows: number
  /** Filled from (and saved to) the ticket or its customer, e.g. customer.name */
  link: string
  /** Calculated fields: e.g. ({Flower price} + {Delivery fee}) * 1.12 (see shared/formula.ts) */
  formula: string
  /** Calculated fields: 'money' or 'number' */
  format: string
}

/** A calculated field's result from the form's other fields ('' until something it uses is filled in). */
export function calcResult(attrs: Pick<FieldAttrs, 'formula' | 'format'>, fields: FormValue[]): string {
  const refs = formulaRefs(attrs.formula)
  const used = fields.filter((x) => refs.some((r) => r.replace(/\s+/g, ' ').trim().toLowerCase() === x.label.replace(/\s+/g, ' ').trim().toLowerCase()))
  if (refs.length && used.every((x) => x.kind !== 'calc' && !x.value.trim())) return ''
  return formatCalc(evaluateFormula(attrs.formula, fields), attrs.format || 'money', formatCurrency)
}

/** "Pick several" values are stored as a JSON list. */
export function multiValues(value: string): string[] {
  try {
    const v = JSON.parse(value) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return value ? [value] : []
  }
}

/** An attribute kept as data-<name> in copied HTML (e.g. labelPos → data-label-pos). */
const attr = <T,>(key: string, fallback: T, parse: (v: string) => T = (v) => v as T) => {
  const name = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(name)
      return v === null ? fallback : parse(v)
    },
    renderHTML: (a: Record<string, unknown>) => ({ [name]: typeof a[key] === 'string' ? a[key] : JSON.stringify(a[key]) })
  }
}

/**
 * A fill-in box inside a document (used by ticket templates): label + input, with its own size, label position,
 * placeholder and hint. The value lives in the node's attrs, so it's saved, copied with templates and searchable.
 */
export const FormField = Node.create({
  name: 'formField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      label: attr('label', ''),
      kind: attr('kind', 'text'),
      options: attr<string[]>('options', [], (v) => {
        try {
          return JSON.parse(v) as string[]
        } catch {
          return []
        }
      }),
      value: attr('value', ''),
      width: attr('width', 'full'),
      labelPos: attr('labelPos', 'left'),
      placeholder: attr('placeholder', ''),
      hint: attr('hint', ''),
      rows: attr('rows', 2, (v) => Number(v) || 2),
      link: attr('link', ''),
      formula: attr('formula', ''),
      format: attr('format', 'money')
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-form-field]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-form-field': '' })]
  },

  renderText({ node }) {
    const v = node.attrs.kind === 'multi' ? multiValues(node.attrs.value).join(', ') : node.attrs.value
    return `${node.attrs.label}: ${v}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(FieldView)
  },

  // Calculated fields: after any change to the document, work them out again in the same step
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('calculatedFields'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null
          const links = useFormLinks.getState()
          const fields = collectFields(state.doc.toJSON() as DocJSON, (link) => (links.active ? links.values[link as keyof typeof links.values] : undefined))
          if (!fields.some((x) => x.kind === 'calc')) return null
          const tr = state.tr
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'formField' || node.attrs.kind !== 'calc') return
            const value = calcResult(node.attrs as FieldAttrs, fields)
            if (value !== node.attrs.value) tr.setNodeMarkup(pos, undefined, { ...node.attrs, value })
          })
          return tr.docChanged ? tr : null
        }
      })
    ]
  }
})

const currencySymbol = (): string => formatCurrency(0).replace(/[\d.,\s ]/g, '') || '$'

/** What a field shows and where its value goes: live from the ticket when it's linked, else its own value. */
export function useFieldValue(attrs: FieldAttrs, editable: boolean, store: (value: string) => void) {
  const links = useFormLinks()
  const link = linkDef(attrs.link)
  const live = Boolean(link && links.active)
  const value = live ? (links.values[link!.id] ?? '') : attrs.value
  const readOnly = !editable || Boolean(link && (!links.active || ('readOnly' in link && link.readOnly)))
  const setValue = (v: string): void => {
    if (live) links.set(link!.id, v)
    store(v) // also kept on the field, for search and for printing
  }
  const placeholder = link && !links.active ? `From the ticket: ${link.label.toLowerCase()}` : attrs.placeholder || undefined
  return { links, link, live, value, readOnly, setValue, placeholder }
}

/** The field's classes: its type, width, label position and whether it's linked */
export const fieldClass = (attrs: FieldAttrs): string =>
  ['ff', `ff-${attrs.kind}`, `ff-w-${attrs.width}`, `ff-l-${attrs.labelPos}`, attrs.link ? 'ff-linked' : ''].filter(Boolean).join(' ')

export function FieldLabel({ attrs }: { attrs: FieldAttrs }) {
  const link = linkDef(attrs.link)
  return (
    <span className="ff-label">
      {attrs.label || 'New field'}
      {link && (
        <span className="ff-link-badge" title={`Linked to the ${link.label.toLowerCase()}: editing it here changes it on the ticket`}>
          <Link2 />
        </span>
      )}
    </span>
  )
}

/** The box itself (input, choices, dropdown…), with existing customers offered under a linked name, and the hint */
export function FieldBody({ attrs, editable, store }: { attrs: FieldAttrs; editable: boolean; store: (value: string) => void }) {
  const group = useId()
  const { links, link, live, value, readOnly, setValue, placeholder } = useFieldValue(attrs, editable, store)
  const aria = attrs.label || 'Field'
  let control: React.ReactNode
  switch (attrs.kind) {
    case 'checkbox':
      control = <input type="checkbox" checked={value === 'true'} disabled={readOnly} aria-label={aria} onChange={(e) => setValue(String(e.target.checked))} />
      break
    case 'select':
      control = (
        <select value={value} disabled={readOnly} aria-label={aria} onChange={(e) => setValue(e.target.value)}>
          <option value="">—</option>
          {attrs.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
      break
    case 'choice':
    case 'multi': {
      const picked = attrs.kind === 'multi' ? multiValues(value) : [value]
      control = (
        <span className="ff-choices" role={attrs.kind === 'choice' ? 'radiogroup' : 'group'} aria-label={aria}>
          {attrs.options.length === 0 && <span className="ff-hint">Add choices with the gear</span>}
          {attrs.options.map((o) => (
            <label key={o} className={`ff-option ${picked.includes(o) ? 'on' : ''}`}>
              <input
                type={attrs.kind === 'choice' ? 'radio' : 'checkbox'}
                name={group}
                checked={picked.includes(o)}
                disabled={readOnly}
                onChange={() => {
                  if (attrs.kind === 'choice') setValue(value === o ? '' : o)
                  else setValue(JSON.stringify(picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]))
                }}
              />
              {o}
            </label>
          ))}
        </span>
      )
      break
    }
    case 'calc':
      control = <input type="text" className="ff-calc-box" value={value} readOnly placeholder={editable ? '' : attrs.formula ? `= ${attrs.formula}` : 'Set the formula with the gear'} aria-label={aria} title={attrs.formula ? `= ${attrs.formula}` : undefined} />
      break
    case 'date':
    case 'time':
      control = <input type={attrs.kind} value={value} readOnly={readOnly} aria-label={aria} onChange={(e) => setValue(e.target.value)} />
      break
    case 'textarea':
      control = (
        <textarea
          rows={attrs.rows}
          style={{ minHeight: `calc(${attrs.rows * 1.5}em + 12px)` }}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-label={aria}
          onChange={(e) => setValue(e.target.value)}
        />
      )
      break
    case 'money':
      control = (
        <span className="ff-money-box">
          <span className="ff-prefix">{currencySymbol()}</span>
          <input type="text" inputMode="decimal" value={value} placeholder={placeholder ?? '0.00'} readOnly={readOnly} aria-label={aria} onChange={(e) => setValue(e.target.value)} />
        </span>
      )
      break
    default:
      control = (
        <input
          type={attrs.kind === 'email' ? 'email' : attrs.kind === 'phone' ? 'tel' : 'text'}
          inputMode={attrs.kind === 'number' ? 'decimal' : undefined}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-label={aria}
          onChange={(e) => setValue(e.target.value)}
          onBlur={link?.id === 'customer.name' && live ? () => links.commit() : undefined}
        />
      )
  }


  return (
    <span className="ff-body">
      {control}
      {link?.id === 'customer.name' && live && !links.hasCustomer && editable && <CustomerSuggestions query={value} onPick={(id) => links.pickCustomer(id)} />}
      {attrs.hint && <span className="ff-hint">{attrs.hint}</span>}
    </span>
  )
}

/** Field attrs with defaults filled in (older fields have fewer) */
export const fieldAttrs = (raw: Record<string, unknown>): FieldAttrs => ({ ...(raw as unknown as FieldAttrs), rows: Number(raw.rows) || 2 })

function FieldView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const attrs = fieldAttrs(node.attrs)
  const editable = editor.isEditable
  const [configuring, setConfiguring] = useState(!attrs.label && editable)
  const otherNames = (): string[] =>
    collectFields(editor.state.doc.toJSON() as DocJSON)
      .map((x) => x.label)
      .filter((l) => l && l !== attrs.label)
  /** After closing the settings, carry on typing right after the field (past the space that follows it). */
  const continueAfter = (): void => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos == null) return
    let at = pos + node.nodeSize
    if (editor.state.doc.textBetween(at, Math.min(at + 1, editor.state.doc.content.size)) === ' ') at += 1
    editor.view.focus() // commands.focus() alone waits a frame
    editor.commands.setTextSelection(at)
  }

  return (
    <NodeViewWrapper as="span" className={fieldClass(attrs)} data-label={attrs.label}>
      {attrs.labelPos !== 'hidden' && <FieldLabel attrs={attrs} />}
      <FieldBody attrs={attrs} editable={editable} store={(value) => updateAttributes({ value })} />
      {editable && (
        <span className="ff-tools" contentEditable={false}>
          <span className="ff-grip" data-drag-handle draggable title="Drag to move" aria-hidden>
            <GripVertical />
          </span>
          <button type="button" className="ff-gear" title="Edit field" aria-label={`Edit field ${attrs.label}`} onClick={() => setConfiguring(true)}>
            <Settings2 />
          </button>
        </span>
      )}
      {configuring && (
        <FieldConfig
          attrs={attrs}
          fieldNames={otherNames()}
          onSave={(next) => {
            updateAttributes(next)
            setConfiguring(false)
            continueAfter()
          }}
          onDelete={deleteNode}
          onCancel={() => {
            if (!attrs.label) return deleteNode()
            setConfiguring(false)
            continueAfter()
          }}
        />
      )}
    </NodeViewWrapper>
  )
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="ff-config-row">
      <span className="ff-config-label">{label}</span>
      <span className="segmented sm" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </span>
    </span>
  )
}

export function FieldConfig({
  attrs,
  fieldNames = [],
  onSave,
  onDelete,
  onCancel
}: {
  attrs: FieldAttrs
  /** The form's other fields, for calculated fields' formulas */
  fieldNames?: string[]
  onSave: (a: Partial<FieldAttrs>) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(attrs)
  const [options, setOptions] = useState(attrs.options.join('\n'))
  const set = (patch: Partial<FieldAttrs>): void => setDraft((d) => ({ ...d, ...patch }))
  const link = linkDef(draft.link)

  const save = (): void => {
    const opts = options
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)
    onSave({ ...draft, label: draft.label.trim() || link?.label || 'Field', options: opts })
  }

  const pickLink = (id: string): void => {
    const next = linkDef(id)
    const prev = linkDef(draft.link)
    set({
      link: id,
      ...(next ? { kind: next.kind as FieldKind } : {}),
      // Name it after what it's linked to, unless it already has its own name
      ...(next && (!draft.label.trim() || draft.label === prev?.label) ? { label: next.label } : {})
    })
  }

  return (
    <span
      className="ff-config"
      role="dialog"
      aria-label="Field settings"
      contentEditable={false}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          save()
        }
      }}
    >
      <label>
        Label
        <input autoFocus value={draft.label} placeholder="e.g. Recipient name" onChange={(e) => set({ label: e.target.value })} aria-label="Field label" />
      </label>
      <span className="ff-config-grid">
        <label>
          Type
          <select value={draft.kind} disabled={Boolean(link)} onChange={(e) => set({ kind: e.target.value as FieldKind })} aria-label="Field type">
            {FIELD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fills in from
          <select value={draft.link} onChange={(e) => pickLink(e.target.value)} aria-label="Fills in from">
            <option value="">Nothing (type it in)</option>
            {FIELD_LINKS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </span>
      {link && <span className="ff-config-note">On a ticket this shows the {link.label.toLowerCase()}{'readOnly' in link ? '' : ', and editing it changes it there too'}.</span>}
      {draft.kind === 'calc' && <FormulaEditor formula={draft.formula ?? ''} format={draft.format || 'money'} names={fieldNames} onChange={(patch) => set(patch)} />}
      {WITH_CHOICES.includes(draft.kind) && (
        <label>
          Choices (one per line)
          <textarea rows={3} value={options} onChange={(e) => setOptions(e.target.value)} aria-label="Choices" />
        </label>
      )}
      <Segmented label="Width" value={draft.width} options={WIDTHS} onChange={(width) => set({ width })} />
      <Segmented label="Label" value={draft.labelPos} options={LABEL_POSITIONS} onChange={(labelPos) => set({ labelPos })} />
      {draft.kind === 'textarea' && <Segmented label="Height" value={draft.rows as 2 | 4 | 8} options={HEIGHTS} onChange={(rows) => set({ rows })} />}
      {WITH_PLACEHOLDER.includes(draft.kind) && !link && (
        <label>
          Placeholder (grey text in the empty box)
          <input value={draft.placeholder} onChange={(e) => set({ placeholder: e.target.value })} aria-label="Placeholder" />
        </label>
      )}
      <label>
        Hint (small text under the box)
        <input value={draft.hint} onChange={(e) => set({ hint: e.target.value })} aria-label="Hint" />
      </label>
      <span className="ff-config-actions">
        <button type="button" className="btn sm danger" onClick={onDelete}>
          Remove
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn sm primary" onClick={save}>
          Done
        </button>
      </span>
    </span>
  )
}

/** Existing customers matching what's typed in a linked "Customer name" field (the ticket has no customer yet). */
function CustomerSuggestions({ query, onPick }: { query: string; onPick: (id: string) => void }) {
  const [matches, setMatches] = useState<CustomerSummary[]>([])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setMatches([])
    const t = setTimeout(() => void api.customers.list({ query: q, limit: 5 }).then(setMatches), 150)
    return () => clearTimeout(t)
  }, [query])
  if (!matches.length) return null
  return (
    <span className="ff-suggest" role="listbox" aria-label="Existing customers" contentEditable={false}>
      {matches.map((c) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={false}
          className="ff-suggest-item"
          onMouseDown={(e) => e.preventDefault()} // keep focus in the field, so leaving it doesn't create a new customer first
          onClick={() => onPick(c.id)}
        >
          <span>{c.name || 'No name'}</span>
          <span className="muted">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
      <span className="ff-suggest-new">Or keep typing for a new customer</span>
    </span>
  )
}

/** A calculated field's formula: type it, or click the form's fields to put them in. */
function FormulaEditor({ formula, format, names, onChange }: { formula: string; format: string; names: string[]; onChange: (patch: { formula?: string; format?: string }) => void }) {
  const unknown = formulaRefs(formula).filter((r) => !names.some((n) => n.replace(/\s+/g, ' ').trim().toLowerCase() === r.replace(/\s+/g, ' ').trim().toLowerCase()))
  const test = formula.trim() ? evaluateFormula(formula, names.map((label) => ({ label, kind: 'number', value: '1' }))) : 0
  return (
    <span className="ff-formula">
      <label>
        Formula
        <input value={formula} placeholder="e.g. ({Price} + {Delivery fee}) * 1.12" onChange={(e) => onChange({ formula: e.target.value })} aria-label="Formula" spellCheck={false} />
      </label>
      {names.length > 0 && (
        <span className="ff-formula-names">
          {names.map((n) => (
            <button key={n} type="button" className="chip-toggle" onClick={() => onChange({ formula: `${formula}${formula && !/[\s(+\-*/]$/.test(formula) ? ' + ' : ''}{${n}}` })}>
              {n}
            </button>
          ))}
        </span>
      )}
      <span className={`ff-config-note ${unknown.length || test === null ? 'warn' : ''}`}>
        {unknown.length
          ? `No field called ${unknown.map((u) => `“${u}”`).join(', ')} on this form.`
          : test === null
            ? 'This formula can’t be worked out yet: check the brackets and signs.'
            : 'Use + − * / and brackets; 12% means 0.12, so tax at 12% is “* 1.12”. Click a field above to add it.'}
      </span>
      <Segmented label="Show as" value={format === 'number' ? 'number' : 'money'} options={[{ id: 'money', label: 'Money' }, { id: 'number', label: 'Number' }] as const} onChange={(v) => onChange({ format: v })} />
    </span>
  )
}
