import type { DocJSON } from './api'

/*
 * Calculated fill-in fields: a formula over other fields of the same form, e.g.
 *   ({Flower price} + {Delivery fee} + {Add-ons}) * 1.12
 * Field names go in {braces} (matched ignoring case and extra spaces). Numbers, + - * / ( ) and % (12% = 0.12)
 * are allowed; nothing else, and nothing is ever run as code. Empty or unreadable fields count as 0.
 */

/** A field as a formula sees it */
export interface FormValue {
  label: string
  kind: string
  value: string
  formula?: string
}

const norm = (label: string): string => label.replace(/\s+/g, ' ').trim().toLowerCase()

/** "$1,250.50" → 1250.5; "" → null. Checkboxes count as 1 when ticked. */
export function parseNumber(text: string): number | null {
  if (text === 'true') return 1
  const cleaned = text.replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/** The field names a formula refers to */
export function formulaRefs(formula: string): string[] {
  return [...formula.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1].trim()).filter(Boolean)
}

type Token = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'ref'; v: string }

function tokenize(formula: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < formula.length) {
    const c = formula[i]
    if (/\s/.test(c)) i++
    else if (c === '{') {
      const end = formula.indexOf('}', i)
      if (end < 0) return null
      out.push({ t: 'ref', v: formula.slice(i + 1, end) })
      i = end + 1
    } else if (/[0-9.]/.test(c)) {
      let j = i
      while (j < formula.length && /[0-9.,]/.test(formula[j])) j++
      const n = Number.parseFloat(formula.slice(i, j).replace(/,/g, ''))
      if (!Number.isFinite(n)) return null
      out.push({ t: 'num', v: n })
      i = j
    } else if ('+-*/()%×÷x'.includes(c)) {
      out.push({ t: 'op', v: c === '×' || c === 'x' ? '*' : c === '÷' ? '/' : c })
      i++
    } else if (c === '$') i++ // "$12" reads as 12
    else return null
  }
  return out
}

/**
 * Works out a formula with the form's other fields. Returns null if the formula can't be read, divides by zero,
 * or refers to a field that doesn't exist. Calculated fields can use other calculated fields (not themselves).
 */
export function evaluateFormula(formula: string, fields: FormValue[], seen: Set<string> = new Set()): number | null {
  const tokens = tokenize(formula)
  if (!tokens || tokens.length === 0) return null
  let pos = 0
  let failed = false
  const lookup = (label: string): number => {
    const key = norm(label)
    const f = fields.find((x) => norm(x.label) === key)
    if (!f) {
      failed = true
      return 0
    }
    if (f.kind === 'calc') {
      if (seen.has(key) || !f.formula) {
        failed = true
        return 0
      }
      const v = evaluateFormula(f.formula, fields, new Set([...seen, key]))
      if (v === null) failed = true
      return v ?? 0
    }
    return parseNumber(f.value) ?? 0
  }
  const peek = (): Token | undefined => tokens[pos]
  const isOp = (v: string): boolean => peek()?.t === 'op' && peek()!.v === v
  // expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ; factor := ('-'|'+') factor | atom '%'?
  const expr = (): number => {
    let v = term()
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].v
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const term = (): number => {
    let v = factor()
    while (isOp('*') || isOp('/')) {
      const op = tokens[pos++].v
      const r = factor()
      if (op === '/' && r === 0) failed = true
      v = op === '*' ? v * r : r === 0 ? 0 : v / r
    }
    return v
  }
  const factor = (): number => {
    if (isOp('-')) {
      pos++
      return -factor()
    }
    if (isOp('+')) {
      pos++
      return factor()
    }
    let v: number
    const tok = peek()
    if (!tok) {
      failed = true
      return 0
    }
    if (tok.t === 'num') {
      pos++
      v = tok.v
    } else if (tok.t === 'ref') {
      pos++
      v = lookup(tok.v)
    } else if (tok.v === '(') {
      pos++
      v = expr()
      if (!isOp(')')) failed = true
      else pos++
    } else {
      failed = true
      return 0
    }
    if (isOp('%')) {
      pos++
      v = v / 100
    }
    return v
  }
  const value = expr()
  if (pos !== tokens.length || failed || !Number.isFinite(value)) return null
  return value
}

/** A result for showing (and storing on the field): money with the currency symbol, or a plain number. */
export function formatCalc(value: number | null, format: string, money: (cents: number) => string): string {
  if (value === null) return ''
  if (format === 'money') return money(Math.round(value * 100))
  return String(Math.round(value * 100) / 100)
}

/**
 * Every fill-in field in a document or canvas, with its current value. `live` gives a linked field's value from the
 * open ticket (e.g. the customer's name), which wins over the copy kept on the field.
 */
export function collectFields(doc: DocJSON | null | undefined, live?: (link: string) => string | undefined): FormValue[] {
  const out: FormValue[] = []
  const walk = (n: DocJSON): void => {
    if (n.type === 'formField') {
      const a = n.attrs ?? {}
      const link = typeof a.link === 'string' ? a.link : ''
      const liveValue = link ? live?.(link) : undefined // unlinked fields (link '') use their own value
      out.push({
        label: String(a.label ?? ''),
        kind: String(a.kind ?? 'text'),
        value: liveValue ?? String(a.value ?? ''),
        formula: typeof a.formula === 'string' ? a.formula : undefined
      })
    }
    for (const c of n.content ?? []) walk(c)
  }
  if (doc) walk(doc)
  return out
}
