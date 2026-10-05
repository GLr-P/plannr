import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import { DEFAULT_DISPLAY, formatCurrency, formatTicketNumber, setDisplayPrefs, statusLabel } from '../../src/shared/api'
import { loadDisplayPrefs, saveDisplayPrefs } from '../../src/main/display'
import * as tickets from '../../src/main/services/tickets'
import { search } from '../../src/main/services/search'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})
afterEach(() => setDisplayPrefs({ ...DEFAULT_DISPLAY })) // the formatters are shared; don't leak into other tests

describe('display preferences', () => {
  it('defaults: NT- tickets, CAD shown with a plain $', () => {
    expect(loadDisplayPrefs(db)).toMatchObject({ ticketPrefix: 'NT-', currency: 'CAD', weekStart: 0 })
    expect(formatTicketNumber(7)).toBe('NT-0007')
    expect(formatCurrency(15750)).toMatch(/^\$157\.50$/)
  })

  it('saves cleaned-up values and they survive a restart', () => {
    saveDisplayPrefs(db, {
      ticketPrefix: ' A B- ',
      currency: 'nope',
      paymentMethods: ['Cash', ' ', 'Cash', ' Interac '],
      statusLabels: { intake: '  Checked in ', ready: '' }
    })
    setDisplayPrefs({ ...DEFAULT_DISPLAY })
    const p = loadDisplayPrefs(db)
    expect(p).toMatchObject({ ticketPrefix: 'AB-', currency: 'CAD', paymentMethods: ['Cash', 'Interac'], statusLabels: { intake: 'Checked in' } })
    expect(statusLabel('intake')).toBe('Checked in')
    expect(statusLabel('ready')).toBe('Ready for pickup')
  })

  it('a new prefix shows in search, and tickets are found by it', () => {
    const t = tickets.createTicket(db, {})
    saveDisplayPrefs(db, { ticketPrefix: 'XY-' })
    expect(search(db, 'XY-0001')[0]?.title).toBe('XY-0001')
    expect(search(db, 'xy1')[0]?.title).toBe('XY-0001') // short forms find it in the main search too
    expect(search(db, '1')[0]?.title).toBe('XY-0001')
    expect(tickets.listTickets(db, { query: 'xy1', status: 'all' }).map((x) => x.id)).toEqual([t.id])
  })
})
