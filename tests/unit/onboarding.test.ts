import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../../src/main/db'
import { ensureOnboardingState } from '../../src/main/services/onboarding'
import { getSetting } from '../../src/main/services/settings'
import * as notes from '../../src/main/services/notes'
import { suggestPrefix } from '../../src/shared/api'

const fresh = () => {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

describe('welcome tour', () => {
  it('a fresh install gets the tour; someone who already has data does not', () => {
    const empty = fresh()
    ensureOnboardingState(empty)
    expect(getSetting(empty, 'onboarded')).toBeNull()

    const used = fresh()
    notes.createNote(used, { title: 'Existing' })
    ensureOnboardingState(used)
    expect(getSetting(used, 'onboarded')).toBe(true)
  })

  it('suggests a ticket prefix from the business name', () => {
    expect(suggestPrefix('Acme Repairs')).toBe('AR-')
    expect(suggestPrefix('Nano Tech Services')).toBe('NTS-')
    expect(suggestPrefix('The Fix-It Shop Inc.')).toBe('FIS-')
    expect(suggestPrefix('')).toBe('T-')
  })
})
