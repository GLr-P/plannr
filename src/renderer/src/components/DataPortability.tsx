import { useState } from 'react'
import { Download, FolderOpen, Upload } from 'lucide-react'
import { api } from '../api'
import { useData } from '../store/data'

/** Settings → Backups & data: export everything to plain files; import contacts from a CSV. */
export function DataPortability() {
  const [exported, setExported] = useState<{ folder: string; notes: number } | null>(null)
  const [imported, setImported] = useState<{ added: number; skipped: number } | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <section className="setting">
        <div>
          <h3>Export everything</h3>
          <p className="muted">Notes as Markdown files (with their pictures), and customers, tickets, money, tasks, inventory and calendar as spreadsheets (CSV). The vault stays encrypted and isn’t included.</p>
          {exported && (
            <p className="small export-done">
              Exported {exported.notes} {exported.notes === 1 ? 'note' : 'notes'} and your lists to <code className="path">{exported.folder}</code>{' '}
              <button type="button" className="link-btn" onClick={() => void api.data.openFolder(exported.folder)}>
                <FolderOpen className="inline-icon" /> Open
              </button>
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await api.data.exportAll()
              if (r) setExported(r)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Download /> {busy ? 'Exporting…' : 'Export…'}
        </button>
      </section>
      <section className="setting">
        <div>
          <h3>Import contacts</h3>
          <p className="muted">From a CSV file, e.g. exported from Google Contacts or Outlook. People already in Plannr (same email, phone or name) are skipped.</p>
          {imported && (
            <p className="small export-done">
              Added {imported.added} {imported.added === 1 ? 'customer' : 'customers'}
              {imported.skipped ? `, skipped ${imported.skipped} already here or empty` : ''}.
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const r = await api.data.importContacts()
            if (r) {
              setImported(r)
              void useData.getState().refresh()
            }
          }}
        >
          <Upload /> Import CSV…
        </button>
      </section>
    </>
  )
}
