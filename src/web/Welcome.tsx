import { useEffect, useState } from 'react'
import { Link2, Share, SquarePlus } from 'lucide-react'
import type { SyncStatus } from '../shared/api'
import { call } from './rpc'

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
const standalone = (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

/**
 * First start on a phone: connect to your Plannr with the link from the PC (the QR code in Settings → Sync & devices).
 * On iPhone, Safari and the Home Screen app keep separate storage, so we suggest adding it to the Home Screen first.
 */
export function Welcome({ joined, persistent, onReady }: { joined: boolean; persistent: boolean; onReady: () => void }) {
  const hashLink = /#join=/.test(location.hash) ? location.href : ''
  const [link, setLink] = useState(hashLink)
  const [stage, setStage] = useState<'install' | 'link' | 'joining'>(hashLink && isIos && !standalone ? 'install' : 'link')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const done = (): void => {
    history.replaceState(null, '', '/') // the key stays out of the address bar
    onReady()
  }

  const join = async (value: string): Promise<void> => {
    setError(null)
    setStage('joining')
    const poll = setInterval(() => void call<SyncStatus>('sync', 'status').then(setStatus), 1_000)
    try {
      await call('sync', 'join', value.trim())
      done()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('link')
    } finally {
      clearInterval(poll)
    }
  }

  useEffect(() => {
    if (joined)
      done() // opened again from the Home Screen (its address still has the link): already connected
    else if (hashLink && stage === 'link') void join(hashLink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (joined) return null
  return (
    <div className="web-welcome">
      <div className="web-welcome-card">
        <div className="brand-mark big">P</div>
        <h1>Plannr</h1>
        {!persistent && (
          <p className="small warn-text">This browser can’t keep Plannr’s data (private browsing?), so it will download everything again next time.</p>
        )}

        {stage === 'install' && (
          <>
            <p>Add Plannr to your Home Screen, then open it from there. It works like an app, even offline.</p>
            <ol className="web-steps">
              <li>
                Tap <Share className="inline-icon" aria-label="Share" /> at the bottom of Safari
              </li>
              <li>
                Choose <SquarePlus className="inline-icon" aria-label="" /> <b>Add to Home Screen</b>, then <b>Add</b>
              </li>
              <li>Open Plannr from your Home Screen</li>
            </ol>
            <button type="button" className="btn link-btn" onClick={() => void join(hashLink)}>
              Or use it here in Safari
            </button>
          </>
        )}

        {stage === 'link' && (
          <form
            className="web-join"
            onSubmit={(e) => {
              e.preventDefault()
              void join(link)
            }}
          >
            <p>
              Connect to your Plannr: on your PC, open Settings → Sync & devices → Show code and link. Scan the code with the Camera, or paste the link here.
            </p>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…/#join=…"
              aria-label="Join link"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn primary" disabled={!link.trim()}>
              <Link2 /> Connect
            </button>
          </form>
        )}

        {stage === 'joining' && (
          <div className="web-joining" aria-live="polite">
            <div className="spinner" />
            <p>Getting your Plannr…</p>
            <p className="small muted">
              The first time takes a minute.
              {status?.filesWaiting ? ` ${status.filesWaiting} files to go.` : ''}
            </p>
          </div>
        )}
        {error && <p className="small error-text">{error}</p>}
      </div>
    </div>
  )
}
