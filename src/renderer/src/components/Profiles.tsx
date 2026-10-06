import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Building2, ChevronDown, Plus, Settings2, X } from 'lucide-react'
import type { Profile } from '../../../shared/api'
import { api } from '../api'
import { useProfiles, switchProfile } from '../store/profiles'
import { go } from '../store/nav'
import { useUi } from '../store/ui'
import { showToast } from '../lib/toast'
import { closeMenu, openMenu, openPanel, type MenuEntry } from './ContextMenu'
import { ConfirmButton } from './common'

/*
 * Profiles: completely separate sets of everything (notes, customers, money, vault, connected accounts),
 * switched from the title bar. Each is its own data folder on the PC; switching restarts Plannr in it.
 */

const COLORS = ['#3b82f6', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#64748b']
const isWeb = (): boolean => document.documentElement.classList.contains('is-web')

export function ProfileDot({ profile, size = 20 }: { profile: Profile; size?: number }) {
  return (
    <span className="brand-mark profile-dot" style={{ background: profile.color, width: size, height: size, fontSize: size * 0.6 }} aria-hidden>
      {profile.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

const useAddProfile = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))
export const openAddProfile = (): void => useAddProfile.getState().set(true)

function openSettings(): void {
  useUi.getState().setPref('settingsTab', 'general')
  go({ view: 'settings' })
}

/** The profile name in the title bar; click to switch, add or manage profiles. */
export function ProfileSwitcher() {
  const state = useProfiles((s) => s.state)
  useEffect(() => {
    if (!isWeb()) void useProfiles.getState().load()
  }, [])
  const active = state?.profiles.find((p) => p.id === state.active)
  const several = (state?.profiles.length ?? 0) > 1

  if (isWeb() || !state)
    return (
      <span className="brand">
        <span className="brand-mark">P</span>
        Plannr
      </span>
    )

  const open = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    const entries: MenuEntry[] = [
      ...state.profiles.map((p) => ({
        label: p.name,
        icon: <ProfileDot profile={p} size={16} />,
        checked: p.id === state.active,
        onSelect: () => (p.id === state.active ? undefined : switchProfile(p.id))
      })),
      'separator',
      { label: 'Add a profile…', icon: <Plus />, onSelect: openAddProfile },
      { label: 'Manage profiles', icon: <Settings2 />, onSelect: openSettings }
    ]
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, entries)
  }

  return (
    <button
      type="button"
      className="brand brand-switch"
      title={several ? 'Switch profile' : 'Plannr · add another profile'}
      aria-label={several ? `Profile: ${active?.name}. Switch profile` : 'Plannr menu'}
      onClick={(e) => open(e.currentTarget)}
    >
      {several && active ? (
        <>
          <ProfileDot profile={active} />
          <span className="brand-name">{active.name}</span>
        </>
      ) : (
        <>
          <span className="brand-mark">P</span>
          Plannr
        </>
      )}
      <ChevronDown className="brand-chevron" />
    </button>
  )
}

function ColorChoice({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="accent-swatches" role="radiogroup" aria-label="Colour">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`accent-swatch ${value === c ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

/** "Add a profile": a name and a colour; then open it now or later. */
export function AddProfileDialog() {
  const { open, set } = useAddProfile()
  const state = useProfiles((s) => s.state)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[1])
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setName('')
    setError('')
    setColor(COLORS[(state?.profiles.length ?? 1) % COLORS.length])
    setTimeout(() => input.current?.focus(), 0)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') set(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null

  const add = async (thenOpen: boolean): Promise<void> => {
    try {
      const p = await api.profiles.add(name, color)
      await useProfiles.getState().load()
      set(false)
      if (thenOpen) await switchProfile(p.id)
      else showToast(`Added ${p.name}`, { label: 'Open it', run: () => void switchProfile(p.id) })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={() => set(false)}>
      <div className="dialog add-profile" role="dialog" aria-label="Add a profile" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Add a profile</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => set(false)}>
            <X />
          </button>
        </div>
        <p className="muted">
          A completely separate Plannr: its own notes, customers, tickets, money, vault, backups and connected accounts (QuickBooks, Zoho,
          Google). Switch between profiles from the name at the top left.
        </p>
        <label className="field">
          <span>Name</span>
          <input
            ref={input}
            value={name}
            aria-label="Profile name"
            placeholder="e.g. Personal, Work, Side job"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void add(true)
            }}
          />
        </label>
        <div className="field">
          <span>Colour</span>
          <ColorChoice value={color} onChange={setColor} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={!name.trim()} onClick={() => void add(false)}>
            Add
          </button>
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={() => void add(true)}>
            Add and open it
          </button>
        </div>
      </div>
    </div>
  )
}

/** Settings → General → Profiles */
export function ProfilesSetting() {
  const state = useProfiles((s) => s.state)
  useEffect(() => {
    void useProfiles.getState().load()
  }, [])
  if (!state) return null
  const update = async (id: string, patch: { name?: string; color?: string }): Promise<void> => {
    try {
      await api.profiles.update(id, patch)
    } catch (err) {
      showToast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
    await useProfiles.getState().load()
  }

  return (
    <section className="setting setting-stack profiles-setting">
      <div>
        <h3>Profiles</h3>
        <p className="muted">
          Each profile is completely separate: notes, customers, tickets, money, vault, backups, sync and connected accounts. Reminders from
          every profile still pop up. To copy a note across, right-click it → Copy to profile.
        </p>
      </div>
      <ul className="profile-list">
        {state.profiles.map((p, i) => (
          <ProfileRow key={p.id} profile={p} open={p.id === state.active} first={i === 0} onChange={(patch) => void update(p.id, patch)} />
        ))}
      </ul>
      <div>
        <button type="button" className="btn" onClick={openAddProfile}>
          <Plus /> Add a profile
        </button>
      </div>
    </section>
  )
}

function ProfileRow({
  profile,
  open,
  first,
  onChange
}: {
  profile: Profile
  open: boolean
  first: boolean
  onChange: (patch: { name?: string; color?: string }) => void
}) {
  const [name, setName] = useState(profile.name)
  useEffect(() => setName(profile.name), [profile.name])
  const pickColor = (el: HTMLElement): void =>
    openPanel(el, 'Colour', () => (
      <div className="profile-colors">
        <ColorChoice
          value={profile.color}
          onChange={(color) => {
            closeMenu()
            onChange({ color })
          }}
        />
      </div>
    ))
  return (
    <li className="profile-row">
      <button type="button" className="profile-color" title="Change colour" aria-label={`Colour of ${profile.name}`} onClick={(e) => pickColor(e.currentTarget)}>
        <ProfileDot profile={profile} size={24} />
      </button>
      <input
        className="profile-name"
        value={name}
        aria-label={`Name of ${profile.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== profile.name && onChange({ name })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {open ? (
        <span className="badge">Open now</span>
      ) : (
        <button type="button" className="btn sm" onClick={() => void switchProfile(profile.id)}>
          <Building2 /> Open
        </button>
      )}
      {!first && !open && (
        <ConfirmButton
          title={`Remove ${profile.name} from this PC? Its notes, customers, money and vault go to the Recycle Bin.`}
          label="Remove"
          onConfirm={async () => {
            await api.profiles.remove(profile.id)
            await useProfiles.getState().load()
            showToast(`Removed ${profile.name} (its folder is in the Recycle Bin)`)
          }}
        />
      )}
    </li>
  )
}
