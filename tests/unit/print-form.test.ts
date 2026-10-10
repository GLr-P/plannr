import { describe, expect, it } from 'vitest'
import { formHtml, printedValue } from '../../src/main/services/print-form'
import { intakeHtml, DEFAULT_BUSINESS } from '../../src/main/services/print'
import { ticketLayout, type DocJSON, type Ticket } from '../../src/shared/api'

const ticket = (content: DocJSON): Ticket => ({
  id: 't1',
  number: 12,
  customerId: 'c1',
  customerName: 'Rosa Lima',
  customerPhone: '555-0123',
  customerEmail: '',
  status: 'intake',
  device: 'Birthday bouquet',
  issue: '',
  priceCents: 10864,
  receivedOn: '2026-10-10',
  pickupOn: '2026-10-24',
  closedAt: null,
  paidCents: 5000,
  taxExempt: false,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  content,
  templateId: null,
  layout: ticketLayout(null)
})
const field = (label: string, attrs: Record<string, unknown>, box = { x: 24, y: 24, w: 300, h: 60 }): DocJSON => ({ type: 'formField', attrs: { label, kind: 'text', value: '', labelPos: 'top', box, ...attrs } })
const canvas: DocJSON = {
  type: 'canvas',
  attrs: { height: 600 },
  content: [
    { type: 'canvasText', attrs: { box: { x: 24, y: 0, w: 400, h: 30 }, text: 'Polka order', style: { size: 24, bold: true } } },
    field('Sender name', { link: 'customer.name' }),
    field('Card Number/s', { value: '4111 1111 1111 1111' }, { x: 24, y: 100, w: 300, h: 60 }),
    field('Flower Price', { kind: 'money', value: '85' }, { x: 24, y: 180, w: 200, h: 60 }),
    field('Total (with tax)', { kind: 'calc', value: '$108.64' }, { x: 240, y: 180, w: 200, h: 60 }),
    field('With fee', { kind: 'calc', formula: '({Flower Price} + 15) * 1.12', value: '' }, { x: 460, y: 180, w: 200, h: 60 }),
    field('Gift wrap', { kind: 'checkbox', value: 'true' }, { x: 24, y: 260, w: 200, h: 40 }),
    field('Delivery', { link: 'ticket.pickupOn', kind: 'date' }, { x: 240, y: 260, w: 200, h: 60 }),
    { type: 'canvasPart', attrs: { box: { x: 24, y: 340, w: 700, h: 80 }, part: 'payments' } }
  ]
}
const data = (content: DocJSON) => ({
  ticket: ticket(content),
  customer: { id: 'c1', name: 'Rosa Lima', phone: '555-0123', email: '', address: '9 Elm St', notes: '', createdAt: 0, updatedAt: 0, deletedAt: null },
  fileData: () => null,
  photos: [],
  linesHtml: '',
  payments: { priceCents: 10864, paidCents: 5000 }
})

describe('the Form printout', () => {
  it('prints every value where it was placed, card numbers included', () => {
    const html = formHtml(data(canvas))
    expect(html).toContain('T-0012 · Birthday bouquet')
    expect(html).toContain('Polka order')
    expect(html).toContain('Rosa Lima') // linked to the customer
    expect(html).toContain('4111 1111 1111 1111') // the shop's own copy keeps it
    expect(html).toContain('$85.00')
    expect(html).toContain('$108.64')
    expect(html).toContain('☑')
    expect(html).toContain('Oct 24, 2026')
    expect(html).toContain('$112.00') // worked out at print time, even if never shown on screen
    expect(html).toContain('Owing') // payments part: $108.64 − $50.00
    expect(html).toMatch(/left:24px;top:100px;width:300px;height:60px/) // at its place on the page
  })

  it('a document form prints in order with its fields filled in', () => {
    const doc: DocJSON = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Delivery' }] },
        { type: 'paragraph', content: [field('Recipient', { value: 'Grace' })] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wrapped' }] }] }] }
      ]
    }
    const html = formHtml(data(doc))
    expect(html).toContain('Delivery')
    expect(html).toContain('Recipient')
    expect(html).toContain('Grace')
    expect(html).toContain('☑ <p>Wrapped</p>')
  })

  it('values read naturally; the customer copy (intake slip) still leaves card numbers out', () => {
    const t = ticket(canvas)
    expect(printedValue({ kind: 'multi', value: '["Pink","White"]' }, t, null)).toBe('Pink, White')
    expect(printedValue({ kind: 'checkbox', value: 'false' }, t, null)).toBe('☐')
    expect(printedValue({ link: 'ticket.number' }, t, null)).toBe('T-0012')
    const slip = intakeHtml({ ticket: t, customer: null, payments: [], business: DEFAULT_BUSINESS, logo: null })
    expect(slip).not.toContain('4111')
    expect(slip).toContain('$108.64')
  })
})
