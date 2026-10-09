import { ALL_DAY_REMINDERS, reminderLabel, TIMED_REMINDERS, type ReminderKind } from '../../../shared/api'

/**
 * "Notify me" choices as toggle buttons: the options that fit a timed or an all-day event, plus any other
 * reminder the event already has (e.g. an event that got a start time after its reminders were chosen).
 */
export function ReminderChips({ value, timed, onChange, label = 'Notify me' }: { value: ReminderKind[]; timed: boolean; onChange: (next: ReminderKind[]) => void; label?: string }) {
  const base = timed ? TIMED_REMINDERS : ALL_DAY_REMINDERS
  const extra = value.filter((k) => !base.some((b) => b.kind === k)).map((kind) => ({ kind, label: reminderLabel(kind) }))
  const options = [...base, ...extra]
  return (
    <div className="chip-toggles" role="group" aria-label={label}>
      <button type="button" className={`chip-toggle ${value.length === 0 ? 'on' : ''}`} aria-pressed={value.length === 0} onClick={() => onChange([])}>
        Don’t notify
      </button>
      {options.map((o) => {
        const on = value.includes(o.kind)
        return (
          <button
            key={o.kind}
            type="button"
            className={`chip-toggle ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((k) => k !== o.kind) : [...value, o.kind])}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
