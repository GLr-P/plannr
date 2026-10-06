import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { answerFileRequests, installApi, web } from './rpc'
import { keyFingerprint, parseJoinLink } from '../shared/sync-crypto'
import { activeProfileId, addFromLink, findByKeyId, recordJoined, setActive } from './profiles'
import { enableLongPress } from './long-press'
import '../renderer/src/styles/global.css'
import '../renderer/src/styles/editor.css'
import '../renderer/src/styles/business.css'
import '../renderer/src/styles/calendar.css'
import '../renderer/src/styles/vault.css'
import '../renderer/src/styles/money.css'
import './mobile.css'

// The phone web app: window.plannr is answered by the database worker; then it's the same screens as on the PC.
installApi()
answerFileRequests()
enableLongPress()
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)

document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void web.poke() // catch up with the PC
})

async function start(): Promise<void> {
  const root = createRoot(document.getElementById('root')!)
  const [{ Welcome }, boot] = await Promise.all([import('./Welcome'), web.boot().catch((err: Error) => ({ error: err.message }))])
  if ('error' in boot) {
    root.render(<p className="web-fatal">{boot.error}</p>)
    return
  }
  const showApp = async (): Promise<void> => {
    const [{ App }, { initTheme }] = await Promise.all([import('../renderer/src/App'), import('../renderer/src/theme')])
    void initTheme()
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  }
  const joinKey = /#join=/.test(location.hash)
  const active = activeProfileId()
  if (boot.joined && boot.keyId && !findByKeyId(boot.keyId)) recordJoined(active, boot.keyId, null) // joined before profiles existed
  // A join link for another sync space (another profile on the PC) adds a profile on this phone, or opens the one it already is.
  const parsed = joinKey ? parseJoinLink(location.href) : null
  if (parsed) {
    const keyId = await keyFingerprint(parsed.key)
    const known = findByKeyId(keyId)
    if (known && known.id !== active) {
      setActive(known.id)
      location.replace('/')
      return
    }
    if (!known && boot.joined) {
      addFromLink(parsed.profile)
      location.reload() // opens the new profile's (empty) database, keeping the link to join with
      return
    }
  }
  if (boot.joined && !joinKey) return showApp()
  root.render(
    <StrictMode>
      <Welcome
        joined={boot.joined}
        persistent={boot.persistent}
        onReady={() => {
          void web.keyId().then((keyId) => keyId && recordJoined(active, keyId, parsed?.profile ?? null))
          void showApp()
        }}
      />
    </StrictMode>
  )
}

void start()
