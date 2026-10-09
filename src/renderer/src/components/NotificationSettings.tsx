import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { DEFAULT_EVENT_REMINDERS, type EventReminderDefaults } from '../../../shared/api'
import { api } from '../api'
import { showToast } from '../lib/toast'
import { ReminderChips } from './ReminderChips'

/** Settings → General → Notifications: what new calendar events notify you about, and a test notification. */
export function NotificationSettings({ pc }: { pc: boolean }) {
  const [defaults, setDefaults] = useState<EventReminderDefaults | null>(null)
  useEffect(() => {
    void api.settings.get('eventReminders').then((v) => setDefaults({ ...DEFAULT_EVENT_REMINDERS, ...((v as Partial<EventReminderDefaults> | null) ?? {}) }))
  }, [])
  if (!defaults) return null
  const save = (patch: Partial<EventReminderDefaults>): void => {
    const next = { ...defaults, ...patch }
    setDefaults(next)
    void api.settings.set('eventReminders', next)
  }

  return (
    <section className="setting setting-stack notification-setting">
      <div className="setting-head">
        <div>
          <h3>Notifications</h3>
          <p className="muted">
            {pc
              ? 'Plannr pops up a Windows notification for calendar events, tasks and bills, even with the window closed (it keeps running in the tray). New events get these; change them on any event.'
              : 'What new calendar events notify you about. Notifications pop up on your PC; change them on any event.'}
          </p>
        </div>
        {pc && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const ok = await api.app.testNotification()
              showToast(
                ok
                  ? 'Sent. Nothing appeared? In Windows Settings → System → Notifications, check Plannr is on and Do not disturb is off.'
                  : 'Windows can’t show notifications on this PC.'
              )
            }}
          >
            <BellRing /> Test notification
          </button>
        )}
      </div>
      <div className="notify-defaults">
        <span className="notify-label">Events with a time</span>
        <ReminderChips label="Events with a time" value={defaults.timed} timed onChange={(timed) => save({ timed })} />
        <span className="notify-label">All-day events</span>
        <ReminderChips label="All-day events" value={defaults.allDay} timed={false} onChange={(allDay) => save({ allDay })} />
      </div>
    </section>
  )
}
