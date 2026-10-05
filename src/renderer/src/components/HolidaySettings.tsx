import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HOLIDAY_REGIONS, type HolidayStatus } from '../../../shared/api'
import { api } from '../api'
import { relativeTime } from '../lib/format'

/** Settings: which country's public holidays (from Google) appear on the calendar. */
export function HolidaySettings() {
  const [status, setStatus] = useState<HolidayStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.holidays.status().then(setStatus)
  }, [])

  const run = async (p: Promise<HolidayStatus>): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await p)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  return (
    <section className="setting">
      <div>
        <h3>Holidays</h3>
        <p className="muted">Public holidays from Google Calendar, shown on your calendar. Updated automatically every week.</p>
        {status.region && (
          <label className="check holiday-observances">
            <input
              type="checkbox"
              checked={status.showObservances}
              onChange={(e) => {
                setStatus({ ...status, showObservances: e.target.checked }) // respond instantly; saving happens in the background
                void run(api.holidays.configure({ showObservances: e.target.checked }))
              }}
            />
            Also show observances (Valentine’s Day, Daylight Saving…)
          </label>
        )}
        <p className="muted small holiday-status" aria-live="polite">
          {busy
            ? 'Updating…'
            : status.error
              ? status.error
              : status.region && status.fetchedAt
                ? `${status.count} holidays · updated ${relativeTime(status.fetchedAt).toLowerCase()}`
                : status.region
                  ? 'Not downloaded yet'
                  : ''}
        </p>
      </div>
      <div className="holiday-controls">
        <select
          className="select"
          value={status.region ?? 'off'}
          onChange={(e) => {
            const region = e.target.value === 'off' ? null : e.target.value
            setStatus({ ...status, region })
            void run(api.holidays.configure({ region }))
          }}
          aria-label="Holiday country"
        >
          <option value="off">Off</option>
          {HOLIDAY_REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        {status.region && (
          <button type="button" className="icon-btn" title="Update now" aria-label="Update holidays now" disabled={busy} onClick={() => void run(api.holidays.refresh())}>
            <RefreshCw />
          </button>
        )}
      </div>
    </section>
  )
}
