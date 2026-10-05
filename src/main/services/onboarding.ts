import type { Db } from '../db'
import { getSetting, setSetting } from './settings'

/**
 * The welcome tour shows once, on a fresh install. Anyone who already has notes, tickets or customers
 * (i.e. was using Plannr before the tour existed) is treated as done.
 */
export function ensureOnboardingState(db: Db): void {
  if (getSetting(db, 'onboarded') !== null) return
  const has = (table: string): boolean => Boolean(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
  if (has('notes') || has('tickets') || has('customers')) setSetting(db, 'onboarded', true)
}
