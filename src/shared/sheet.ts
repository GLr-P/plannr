/**
 * Spreadsheet blocks in notes: cells hold text, numbers or formulas (=A1+B2, =SUM(A1:A5), =IF(B2>100, B2*0.9, B2)).
 * A small safe evaluator (no eval): numbers, cell references, ranges, + - * / ^ %, comparisons and a few functions.
 */

export type ColumnFormat = 'auto' | 'number' | 'money' | 'percent' | 'text'

export const colName = (i: number): string => {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
export const cellName = (r: number, c: number): string => `${colName(c)}${r + 1}`

function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})(\d{1,5})$/.exec(ref.toUpperCase())
  if (!m) return null
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

/** A plain number from what's in a cell ("$1,299.50", "12%", "  4 ") */
export function cellNumber(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const pct = t.endsWith('%')
  const n = Number(t.replace(/[$,%\s]/g, ''))
  if (!Number.isFinite(n) || !/\d/.test(t)) return null
  return pct ? n / 100 : n
}

type Value = number | string | boolean | null
type Token = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'range'; a: string; b: string } | { t: 'fn'; v: string } | { t: 'op'; v: string } | { t: '('} | { t: ')' } | { t: ',' }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^\d+(\.\d+)?|^\.\d+/.exec(rest))) {
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
    } else if ((m = /^"([^"]*)"/.exec(rest))) {
      out.push({ t: 'str', v: m[1] })
      i += m[0].length
    } else if ((m = /^([A-Za-z]{1,3}\d{1,5}):([A-Za-z]{1,3}\d{1,5})/.exec(rest))) {
      out.push({ t: 'range', a: m[1].toUpperCase(), b: m[2].toUpperCase() })
      i += m[0].length
    } else if ((m = /^([A-Za-z]+)\s*\(/.exec(rest))) {
      out.push({ t: 'fn', v: m[1].toUpperCase() })
      i += m[0].length - 1
    } else if ((m = /^[A-Za-z]{1,3}\d{1,5}/.exec(rest))) {
      out.push({ t: 'ref', v: m[0].toUpperCase() })
      i += m[0].length
    } else if ((m = /^(<=|>=|<>|!=|[+\-*/^%<>=&])/.exec(rest))) {
      out.push({ t: 'op', v: m[0] })
      i += m[0].length
    } else if (ch === '(' || ch === ')' || ch === ',' || ch === ';') {
      out.push(ch === '(' ? { t: '(' } : ch === ')' ? { t: ')' } : { t: ',' })
      i++
    } else throw new Error(`Unexpected “${ch}”`)
  }
  return out
}

const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v === null || v === '' ? 0 : (cellNumber(String(v)) ?? 0))

const FUNCTIONS: Record<string, (args: Value[][]) => Value> = {
  SUM: (a) => a.flat().reduce<number>((s, v) => s + (v === null || v === '' ? 0 : num(v)), 0),
  AVERAGE: (a) => {
    const n = a.flat().filter((v) => v !== null && v !== '' && cellNumber(String(v)) !== null)
    return n.length ? n.reduce<number>((s, v) => s + num(v), 0) / n.length : 0
  },
  MIN: (a) => Math.min(...a.flat().filter((v) => v !== null && v !== '').map(num)),
  MAX: (a) => Math.max(...a.flat().filter((v) => v !== null && v !== '').map(num)),
  COUNT: (a) => a.flat().filter((v) => v !== null && v !== '' && cellNumber(String(v)) !== null).length,
  COUNTA: (a) => a.flat().filter((v) => v !== null && v !== '').length,
  ROUND: (a) => {
    const f = 10 ** num(a[1]?.[0] ?? 0)
    return Math.round(num(a[0]?.[0] ?? 0) * f) / f
  },
  ABS: (a) => Math.abs(num(a[0]?.[0] ?? 0)),
  SQRT: (a) => Math.sqrt(num(a[0]?.[0] ?? 0)),
  IF: (a) => (num(a[0]?.[0] ?? 0) ? (a[1]?.[0] ?? '') : (a[2]?.[0] ?? '')),
  TODAY: () => new Date().toLocaleDateString('en-CA')
}
FUNCTIONS.AVG = FUNCTIONS.AVERAGE
FUNCTIONS.MEAN = FUNCTIONS.AVERAGE

/** Works out every cell of a grid; formulas show their result (or an error message starting with #) */
export function evaluateSheet(cells: string[][]): Value[][] {
  const cache = new Map<string, Value>()
  const busy = new Set<string>()
  const raw = (r: number, c: number): string => cells[r]?.[c] ?? ''

  const value = (r: number, c: number): Value => {
    const key = `${r},${c}`
    if (cache.has(key)) return cache.get(key)!
    const text = raw(r, c)
    let v: Value
    if (text.startsWith('=')) {
      if (busy.has(key)) return '#LOOP'
      busy.add(key)
      try {
        v = evalFormula(text.slice(1))
      } catch (e) {
        v = `#${e instanceof Error ? e.message : 'ERROR'}`
      }
      busy.delete(key)
    } else v = cellNumber(text) ?? (text === '' ? null : text)
    cache.set(key, v)
    return v
  }

  const evalFormula = (src: string): Value => {
    const tokens = tokenize(src)
    let p = 0
    const peek = (): Token | undefined => tokens[p]
    const take = (): Token => tokens[p++]
    const isOp = (...ops: string[]): boolean => peek()?.t === 'op' && ops.includes((peek() as { v: string }).v)

    const rangeValues = (a: string, b: string): Value[] => {
      const x = parseRef(a)
      const y = parseRef(b)
      if (!x || !y) throw new Error('REF')
      const out: Value[] = []
      for (let r = Math.min(x.r, y.r); r <= Math.max(x.r, y.r); r++) for (let c = Math.min(x.c, y.c); c <= Math.max(x.c, y.c); c++) out.push(value(r, c))
      return out
    }
    const primary = (): Value => {
      const tok = take()
      if (!tok) throw new Error('INCOMPLETE')
      if (tok.t === 'num') return tok.v
      if (tok.t === 'str') return tok.v
      if (tok.t === 'ref') {
        const at = parseRef(tok.v)
        if (!at) throw new Error('REF')
        const v = value(at.r, at.c)
        if (typeof v === 'string' && v.startsWith('#')) throw new Error(v.slice(1))
        return v
      }
      if (tok.t === 'range') throw new Error('RANGE') // ranges only inside functions
      if (tok.t === 'op' && (tok.v === '-' || tok.v === '+')) return tok.v === '-' ? -num(unary()) : num(unary())
      if (tok.t === '(') {
        const v = comparison()
        if (take()?.t !== ')') throw new Error('PAREN')
        return v
      }
      if (tok.t === 'fn') {
        const fn = FUNCTIONS[tok.v]
        if (!fn) throw new Error('NAME')
        take() // (
        const args: Value[][] = []
        if (peek()?.t !== ')') {
          for (;;) {
            const nxt = peek()
            if (nxt?.t === 'range' && (tokens[p + 1]?.t === ',' || tokens[p + 1]?.t === ')')) {
              take()
              args.push(rangeValues(nxt.a, nxt.b))
            } else args.push([comparison()])
            if (peek()?.t === ',') {
              take()
              continue
            }
            break
          }
        }
        if (take()?.t !== ')') throw new Error('PAREN')
        return fn(args)
      }
      throw new Error('SYNTAX')
    }
    const unary = (): Value => {
      let v = primary()
      while (isOp('%')) {
        take()
        v = num(v) / 100
      }
      return v
    }
    const power = (): Value => {
      let v = unary()
      while (isOp('^')) {
        take()
        v = num(v) ** num(unary())
      }
      return v
    }
    const term = (): Value => {
      let v = power()
      while (isOp('*', '/')) {
        const op = (take() as { v: string }).v
        const rhs = num(power())
        if (op === '/' && rhs === 0) throw new Error('DIV/0')
        v = op === '*' ? num(v) * rhs : num(v) / rhs
      }
      return v
    }
    const sum = (): Value => {
      let v = term()
      while (isOp('+', '-', '&')) {
        const op = (take() as { v: string }).v
        const rhs = term()
        v = op === '&' ? `${v ?? ''}${rhs ?? ''}` : op === '+' ? num(v) + num(rhs) : num(v) - num(rhs)
      }
      return v
    }
    const comparison = (): Value => {
      const v = sum()
      if (isOp('<', '>', '<=', '>=', '=', '<>', '!=')) {
        const op = (take() as { v: string }).v
        const a = num(v)
        const b = num(sum())
        return { '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b, '=': a === b, '<>': a !== b, '!=': a !== b }[op] ? 1 : 0
      }
      return v
    }
    const v = comparison()
    if (p < tokens.length) throw new Error('SYNTAX')
    return typeof v === 'number' && !Number.isFinite(v) ? '#NUM' : v
  }

  return cells.map((row, r) => row.map((_, c) => value(r, c)))
}

/** A cell's result as shown, with its column's format */
export function formatCell(v: Value, format: ColumnFormat, money: (cents: number) => string): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return v
  if (format === 'text') return String(v)
  if (format === 'money') return money(Math.round(v * 100))
  if (format === 'percent') return `${Math.round(v * 1000) / 10}%`
  if (format === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** One line of arithmetic: "12 * 3.5 + 10%" → 46.2 (null when it isn't a calculation) */
export function calculate(expression: string): number | null {
  const e = expression.trim().replace(/^=/, '').replace(/×/g, '*').replace(/÷/g, '/')
  if (!e || !/[\d)]/.test(e)) return null
  const [[v]] = evaluateSheet([[`=${e}`]])
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
