import { describe, expect, it } from 'vitest'
import { intakeHtml, labelHtml, receiptHtml, receiptTotals, ticketFields, DEFAULT_BUSINESS, type PrintData } from '../../src/main/services/print'
import type { DocJSON, Ticket, Transaction } from '../../src/shared/api'

const field = (label: string, value: string, kind = 'text'): DocJSON => ({ type: 'formField', attrs: { label, value, kind } })
const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1',
  number: 7,
  customerId: null,
  customerName: 'Jane <Doe>',
  customerPhone: '555-0100',
  customerEmail: '',
  status: 'intake',
  device: 'iPhone 13',
  issue: 'Cracked screen',
  priceCents: 15750,
  receivedOn: '2026-10-05',
  pickupOn: null,
  closedAt: null,
  paidCents: 0,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [field('Passcode', '1234'), field('Condition', 'Scuffed'), field('Charger left', 'true', 'checkbox'), field('Notes', '')] }] },
  templateId: null,
  ...over
})
const pay = (amountCents: number, taxExempt = false): Transaction => ({
  id: String(amountCents),
  date: '2026-10-05',
  type: 'income',
  amountCents,
  description: '',
  category: '',
  method: 'Card',
  ticketId: 't1',
  ticketLabel: '',
  recurringId: null,
  taxExempt,
  qboInvoice: '',
  updatedAt: 0
})
const data = (over: Partial<PrintData> = {}): PrintData => ({
  ticket: ticket(),
  customer: null,
  payments: [],
  business: { ...DEFAULT_BUSINESS, name: 'Nano Tech Services', taxName: 'GST', taxRate: 5, taxNumber: '123456789RT0001', intakeTerms: 'Not responsible for data loss.' },
  logo: null,
  ...over
})

describe('printouts', () => {
  it('ticket fields skip passcodes and empty ones; checkboxes read Yes', () => {
    expect(ticketFields(ticket().content)).toEqual([
      { label: 'Condition', value: 'Scuffed' },
      { label: 'Charger left', value: 'Yes' }
    ])
  })

  it('intake slip: business, ticket number, customer (escaped), repair, terms and a signature line; no passcode', () => {
    const html = intakeHtml(data())
    expect(html).toContain('Nano Tech Services')
    expect(html).toContain('Repair ticket T-0007')
    expect(html).toContain('Jane &lt;Doe&gt;')
    expect(html).toContain('Cracked screen')
    expect(html).toContain('Not responsible for data loss.')
    expect(html).toContain('Customer signature')
    expect(html).not.toContain('1234')
  })

  it('receipt splits the tax out of what was paid; "no tax" payments carry none', () => {
    expect(receiptTotals([pay(15750)], 5)).toEqual({ subtotal: 15000, tax: 750, total: 15750 })
    expect(receiptTotals([pay(10000), pay(5000, true)], 5)).toEqual({ subtotal: 14524, tax: 476, total: 15000 })
    const html = receiptHtml(data({ payments: [pay(15750)] }))
    expect(html).toContain('GST (5%)')
    expect(html).toContain('#123456789RT0001')
    expect(html).toContain('$157.50')
    expect(html).not.toContain('Balance owing')
    expect(receiptHtml(data({ payments: [pay(5000)] }))).toContain('Balance owing: $107.50')
  })

  it('label uses the chosen label size', () => {
    expect(labelHtml(data())).toContain('size: 62mm 29mm')
    expect(labelHtml(data({ business: { ...DEFAULT_BUSINESS, labelSize: '2.25x1.25in' } }))).toContain('size: 2.25in 1.25in')
  })
})
