import { shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Db } from './db'
import type { Profile, ProfilesState } from '../shared/api'
import { addProfile, loadRegistry, MAIN_PROFILE, profileDir, removeProfile, saveRegistry, updateProfile, type ProfileRegistry } from './profiles'
import { getBusiness } from './services/print'
import { copyNoteTo, moveNoteTo, type Store } from './services/transfer'

/** Another (not open) profile whose database is open for reminders or copying. */
export interface OtherProfile extends Store {
  profile: Profile
}

/**
 * The profiles on this PC (see profiles.ts). Only one is open at a time; switching relaunches Plannr so
 * nothing from one profile (timers, sign-ins, a QuickBooks sync in progress) can reach the other.
 * The others' databases are opened only for reminders and copying.
 */
export class ProfileManager {
  readonly registry: ProfileRegistry
  private others = new Map<string, Db>()

  constructor(
    readonly base: string,
    /** Restarts Plannr in the newly chosen profile */
    private relaunch: () => void,
    /** Gets rid of a removed profile's folder (the Recycle Bin; tests delete it) */
    private discard: (dir: string) => Promise<void> = (dir) => shell.trashItem(dir)
  ) {
    this.registry = loadRegistry(base)
  }

  get active(): Profile {
    return this.registry.profiles.find((p) => p.id === this.registry.active)!
  }

  get dir(): string {
    return profileDir(this.base, this.registry.active)
  }

  /** On the very first start the first profile is named after the business details, if filled in (otherwise "Main"). */
  adoptName(db: Db): void {
    if (existsSync(join(this.base, 'profiles.json')) || this.registry.active !== MAIN_PROFILE) return
    const name = getBusiness(db).name.trim()
    if (name) this.active.name = name.slice(0, 60)
  }

  state(): ProfilesState {
    return { active: this.registry.active, profiles: this.registry.profiles.map((p) => ({ ...p })) }
  }

  add(name: string, color?: string): Profile {
    return addProfile(this.base, this.registry, name, color) // its data starts when it is first opened (with the welcome tour)
  }

  update(id: string, patch: { name?: string; color?: string }): Profile {
    return updateProfile(this.base, this.registry, id, patch)
  }

  async remove(id: string): Promise<void> {
    this.closeOther(id) // Windows won't move a folder with an open database
    const aside = removeProfile(this.base, this.registry, id)
    if (aside) await this.discard(aside).catch(() => undefined) // left in profiles/ if the Recycle Bin refuses it
  }

  switchTo(id: string, navigate?: ProfileRegistry['navigate']): void {
    if (!this.registry.profiles.some((p) => p.id === id)) throw new Error('That profile no longer exists')
    this.registry.active = id
    this.registry.navigate = navigate
    saveRegistry(this.base, this.registry)
    this.closeAll()
    this.relaunch()
  }

  /** The other profiles that have been opened at least once (so have a database). */
  otherProfiles(): OtherProfile[] {
    const out: OtherProfile[] = []
    for (const profile of this.registry.profiles) {
      if (profile.id === this.registry.active) continue
      const db = this.otherDb(profile.id)
      if (db) out.push({ profile, db, dir: profileDir(this.base, profile.id) })
    }
    return out
  }

  copyNote(from: Store, noteId: string, targetId: string, move: boolean): void {
    if (targetId === this.registry.active) throw new Error('That note is already in this profile')
    const target = this.registry.profiles.find((p) => p.id === targetId)
    if (!target) throw new Error('That profile no longer exists')
    const dir = profileDir(this.base, targetId)
    const db = this.otherDb(targetId) ?? this.openOther(targetId)
    const to = { db, dir }
    if (move) moveNoteTo(from, to, noteId)
    else copyNoteTo(from, to, noteId)
  }

  closeAll(): void {
    for (const id of [...this.others.keys()]) this.closeOther(id)
  }

  private otherDb(id: string): Db | null {
    const open = this.others.get(id)
    if (open) return open
    if (!existsSync(join(profileDir(this.base, id), 'plannr.db'))) return null
    return this.openOther(id)
  }

  private openOther(id: string): Db {
    const db = openDb(join(profileDir(this.base, id), 'plannr.db'))
    this.others.set(id, db)
    return db
  }

  private closeOther(id: string): void {
    const db = this.others.get(id)
    if (!db) return
    this.others.delete(id)
    try {
      db.close()
    } catch {
      // already closed
    }
  }
}
