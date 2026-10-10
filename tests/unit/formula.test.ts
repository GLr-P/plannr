import { describe, expect, it } from 'vitest'
import { collectFields, evaluateFormula, formatCalc, formulaRefs, parseNumber, type FormValue } from '../../src/shared/formula'

const f = (label: string, value: string, kind = 'money', formula?: string): FormValue => ({ label, kind, value, formula })
const money = (c: number): string => `$${(c / 100).toFixed(2)}`

describe('calculated fields', () => {
  const fields = [f('Flower Price', '$85.00'), f('Delivery Fee?', '12'), f('Addons?', '1,000.50'), f('Rush', 'true', 'checkbox'), f('Notes', 'hello', 'text')]

  it('reads numbers the way people type them', () => {
    expect(parseNumber('$1,250.50')).toBe(1250.5)
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('true')).toBe(1)
  })

  it('adds fields and applies tax, with field names in braces', () => {
    expect(evaluateFormula('({Flower Price} + {Delivery Fee?} + {Addons?}) * 1.12', fields)).toBeCloseTo((85 + 12 + 1000.5) * 1.12)
    expect(evaluateFormula('({flower price}+{delivery   fee?}) × 1.12', fields)).toBeCloseTo(97 * 1.12) // case and spaces don't matter
    expect(evaluateFormula('{Flower Price} + 12%  * {Flower Price}', fields)).toBeCloseTo(85 + 0.12 * 85)
    expect(evaluateFormula('-{Delivery Fee?} + 2 * (3 + 4)', fields)).toBe(2)
    expect(evaluateFormula('{Rush} * 20', fields)).toBe(20)
  })

  it('empty fields count as 0; nonsense gives no answer instead of a wrong one', () => {
    expect(evaluateFormula('{Notes} + 5', fields)).toBe(5)
    expect(evaluateFormula('{Missing field} + 5', fields)).toBeNull()
    expect(evaluateFormula('5 / 0', fields)).toBeNull()
    expect(evaluateFormula('(5 + 2', fields)).toBeNull()
    expect(evaluateFormula('5 +', fields)).toBeNull()
    expect(evaluateFormula('alert(1)', fields)).toBeNull()
    expect(evaluateFormula('', fields)).toBeNull()
  })

  it('calculated fields can use each other, but not go round in circles', () => {
    const withCalcs = [...fields, f('Subtotal', '', 'calc', '{Flower Price} + {Delivery Fee?}'), f('Total', '', 'calc', '{Subtotal} * 1.12'), f('Loop', '', 'calc', '{Loop} + 1')]
    expect(evaluateFormula('{Subtotal} * 1.12', withCalcs)).toBeCloseTo(97 * 1.12)
    expect(evaluateFormula('{Total}', withCalcs)).toBeCloseTo(97 * 1.12)
    expect(evaluateFormula('{Loop}', withCalcs)).toBeNull()
    expect(formulaRefs('({Flower Price} + {Delivery Fee?}) * 1.12')).toEqual(['Flower Price', 'Delivery Fee?'])
  })

  it('shows money with the currency, and finds fields in documents and canvases, live values first', () => {
    expect(formatCalc(108.640001, 'money', money)).toBe('$108.64')
    expect(formatCalc(3.14159, 'number', money)).toBe('3.14')
    expect(formatCalc(null, 'money', money)).toBe('')
    const doc = {
      type: 'canvas',
      content: [
        { type: 'formField', attrs: { label: 'Customer name', value: 'old', link: 'customer.name' } },
        { type: 'canvasText', attrs: { text: 'hi' } },
        { type: 'formField', attrs: { label: 'Price', kind: 'money', value: '12', link: '' } },
        { type: 'formField', attrs: { label: 'Total', kind: 'calc', formula: '1+1', value: '' } }
      ]
    }
    expect(collectFields(doc, (link) => (link === 'customer.name' ? 'Rosa' : undefined))).toEqual([
      { label: 'Customer name', kind: 'text', value: 'Rosa', formula: undefined },
      { label: 'Price', kind: 'money', value: '12', formula: undefined }, // no link: its own value
      { label: 'Total', kind: 'calc', value: '', formula: '1+1' }
    ])
  })
})
