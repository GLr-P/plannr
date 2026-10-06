/*
 * Profiles on the phone. Each profile is its own database in the browser's private storage, joined to that
 * profile's sync space with its own link (from Settings → Sync & devices on the PC, while that profile is open).
 * The list lives in localStorage; the database worker opens only the active profile. Switching reloads the page.
 */
import type { Profile, ProfilesState } from '../shared/api'
import type { LinkProfile } from '../shared/sync-crypto'

export const MAIN_PROFILE = 'main'
const KEY = 'plannr-profiles'
const COLORS = ['#3b82f6', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#64748b']

/** A profile on this phone; keyId = fingerprint of the sync space it joined (never the key itself) */
export interface PhoneProfile extends Profile {
  keyId?: string
}

interface Registry {
  active: string
  profiles: PhoneProfile[]
}

function load(): Registry {
  let reg: Partial<Registry> = {}
  try {
    reg = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Registry>
  } catch {
    // unreadable or blocked: just the first profile
  }
  const profiles = (Array.isArray(reg.profiles) ? reg.profiles : []).filter((p) => typeof p?.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id))
  if (!profiles.some((p) => p.id === MAIN_PROFILE)) profiles.unshift({ id: MAIN_PROFILE, name: 'Main', color: COLORS[0] })
  return { active: profiles.some((p) => p.id === reg.active) ? reg.active! : MAIN_PROFILE, profiles }
}

function save(reg: Registry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(reg))
  } catch {
    // private browsing: profiles last for this visit only
  }
}

export const activeProfileId = (): string => load().active

export function profilesState(): ProfilesState {
  const reg = load()
  return { active: reg.active, profiles: reg.profiles.map(({ id, name, color }) => ({ id, name, color })) }
}

export const findByKeyId = (keyId: string): PhoneProfile | undefined => load().profiles.find((p) => p.keyId === keyId)

export function setActive(id: string): void {
  const reg = load()
  if (!reg.profiles.some((p) => p.id === id)) throw new Error('That profile is no longer on this phone')
  save({ ...reg, active: id })
}

/** A new profile for another sync space (named after the link's profile when it has one); becomes the active one. */
export function addFromLink(profile: LinkProfile | null): PhoneProfile {
  const reg = load()
  let name = profile?.name || `Profile ${reg.profiles.length + 1}`
  for (let n = 2; reg.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++) name = `${profile?.name || 'Profile'} ${n}`
  const p: PhoneProfile = { id: crypto.randomUUID().slice(0, 8), name, color: profile?.color ?? COLORS[reg.profiles.length % COLORS.length] }
  save({ active: p.id, profiles: [...reg.profiles, p] })
  return p
}

/** After joining: remember which space this profile is, and take the link's name if it still has the default one. */
export function recordJoined(id: string, keyId: string, profile: LinkProfile | null): void {
  const reg = load()
  const p = reg.profiles.find((x) => x.id === id)
  if (!p) return
  p.keyId = keyId
  if (profile && (p.name === 'Main' || /^Profile \d+$/.test(p.name)) && !reg.profiles.some((x) => x.id !== id && x.name === profile.name)) {
    p.name = profile.name
    p.color = profile.color
  }
  save(reg)
}

export function updateProfile(id: string, patch: { name?: string; color?: string }): Profile {
  const reg = load()
  const p = reg.profiles.find((x) => x.id === id)
  if (!p) throw new Error('That profile is no longer on this phone')
  if (patch.name !== undefined) {
    const name = patch.name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name) throw new Error('Give the profile a name')
    if (reg.profiles.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a profile called “${name}”`)
    p.name = name
  }
  if (patch.color !== undefined && /^#[0-9a-f]{6}$/i.test(patch.color)) p.color = patch.color
  save(reg)
  return { id: p.id, name: p.name, color: p.color }
}

/** Takes a profile off the list (its data is deleted by the worker). Not the first or the open one. */
export function removeFromList(id: string): void {
  const reg = load()
  if (id === MAIN_PROFILE) throw new Error('The first profile can’t be removed (you can rename it)')
  if (id === reg.active) throw new Error('Switch to another profile before removing this one')
  save({ ...reg, profiles: reg.profiles.filter((p) => p.id !== id) })
}
