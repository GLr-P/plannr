import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, NavigateTarget } from '../shared/api'

/**
 * Profiles ("profiles"): each one is its own data folder, so its database, attachments, vault, settings,
 * sign-ins and sync key are completely separate. The first profile is the original data folder; others live
 * in <base>/profiles/<id>. The list, the open one and the window position are kept in <base>/profiles.json.
 * No Electron here, so it's unit-tested in plain Node.
 */
export interface ProfileRegistry {
  active: string
  profiles: Profile[]
  /** Window size/position carried across a switch (which relaunches the app) */
  window?: { x: number; y: number; width: number; height: number; maximized: boolean }
  /** What to show after switching (e.g. the item a notification was about); used once */
  navigate?: NavigateTarget
}

export const MAIN_PROFILE = 'main'
export const PROFILE_COLORS = ['#3b82f6', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#64748b']

const registryFile = (base: string): string => join(base, 'profiles.json')

export function profileDir(base: string, id: string): string {
  return id === MAIN_PROFILE ? base : join(base, 'profiles', id)
}

const cleanName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, 60)
const cleanColor = (color: string | undefined, fallback: string): string => (color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback)

/** Reads the list; with no file yet there is just the first profile, named `mainName`. */
export function loadRegistry(base: string, mainName = 'Main'): ProfileRegistry {
  let reg: Partial<ProfileRegistry> = {}
  try {
    reg = JSON.parse(readFileSync(registryFile(base), 'utf8')) as Partial<ProfileRegistry>
  } catch {
    // no file yet (single profile) or unreadable: start from the first profile
  }
  const profiles = (Array.isArray(reg.profiles) ? reg.profiles : []).filter(
    (p): p is Profile => typeof p?.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id) && typeof p.name === 'string'
  )
  if (!profiles.some((p) => p.id === MAIN_PROFILE)) profiles.unshift({ id: MAIN_PROFILE, name: cleanName(mainName) || 'Main', color: PROFILE_COLORS[0] })
  const active = profiles.some((p) => p.id === reg.active) ? reg.active! : MAIN_PROFILE
  return { ...reg, active, profiles }
}

export function saveRegistry(base: string, reg: ProfileRegistry): void {
  mkdirSync(base, { recursive: true })
  const file = registryFile(base)
  writeFileSync(file + '.tmp', JSON.stringify(reg, null, 2))
  renameSync(file + '.tmp', file) // never leave a half-written list
}

export function addProfile(base: string, reg: ProfileRegistry, name: string, color?: string): Profile {
  const clean = cleanName(name)
  if (!clean) throw new Error('Give the profile a name')
  if (reg.profiles.some((p) => p.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a profile called “${clean}”`)
  const id = randomUUID().slice(0, 8)
  const profile = { id, name: clean, color: cleanColor(color, PROFILE_COLORS[reg.profiles.length % PROFILE_COLORS.length]) }
  mkdirSync(profileDir(base, id), { recursive: true })
  reg.profiles.push(profile)
  saveRegistry(base, reg)
  return profile
}

export function updateProfile(base: string, reg: ProfileRegistry, id: string, patch: { name?: string; color?: string }): Profile {
  const p = reg.profiles.find((x) => x.id === id)
  if (!p) throw new Error('That profile no longer exists')
  if (patch.name !== undefined) {
    const clean = cleanName(patch.name)
    if (!clean) throw new Error('Give the profile a name')
    if (reg.profiles.some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a profile called “${clean}”`)
    p.name = clean
  }
  if (patch.color !== undefined) p.color = cleanColor(patch.color, p.color)
  saveRegistry(base, reg)
  return p
}

/**
 * Takes a profile off the list and moves its folder aside to <base>/profiles/removed-<id>-<time> (the caller
 * may then send it to the Recycle Bin). The first profile and the open one can't be removed.
 */
export function removeProfile(base: string, reg: ProfileRegistry, id: string, now = Date.now()): string | null {
  if (id === MAIN_PROFILE) throw new Error('The first profile can’t be removed (you can rename it)')
  if (id === reg.active) throw new Error('Switch to another profile before removing this one')
  if (!reg.profiles.some((p) => p.id === id)) throw new Error('That profile no longer exists')
  reg.profiles = reg.profiles.filter((p) => p.id !== id)
  saveRegistry(base, reg)
  const dir = profileDir(base, id)
  if (!existsSync(dir)) return null
  const aside = join(base, 'profiles', `removed-${id}-${now}`)
  renameSync(dir, aside)
  return aside
}
