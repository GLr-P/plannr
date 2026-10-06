import { create } from 'zustand'
import type { Profile, ProfilesState } from '../../../shared/api'
import { api } from '../api'
import { go } from './nav'

/** The profiles on this PC (each completely separate) and which one is open. */
export const useProfiles = create<{ state: ProfilesState | null; load: () => Promise<void> }>((set) => ({
  state: null,
  load: async () => set({ state: await api.profiles.list() })
}))

/** The profiles that aren't open (for "Copy to" menus). */
export function otherProfiles(): Profile[] {
  const s = useProfiles.getState().state
  return s ? s.profiles.filter((p) => p.id !== s.active) : []
}

export function activeProfile(): Profile | null {
  const s = useProfiles.getState().state
  return s?.profiles.find((p) => p.id === s.active) ?? null
}

/** Opens another profile. Plannr restarts in it; leaving the current page first saves anything still being typed. */
export async function switchProfile(id: string): Promise<void> {
  go({ view: 'home' })
  await new Promise((r) => setTimeout(r, 150))
  await api.profiles.switch(id)
}
