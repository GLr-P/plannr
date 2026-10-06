import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { answerFileRequests, installApi, web } from './rpc'
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
  if (boot.joined && !joinKey) return showApp()
  root.render(
    <StrictMode>
      <Welcome joined={boot.joined} persistent={boot.persistent} onReady={() => void showApp()} />
    </StrictMode>
  )
}

void start()
