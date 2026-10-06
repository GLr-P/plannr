/*
 * Plannr's service worker: keeps the app working offline (the page and its files are cached as they load), and
 * serves pictures and files from the on-device database at /plannr-file/<id> and /plannr-vault/<id>/<name>.
 */
const CACHE = 'plannr-app-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/')).catch(() => undefined))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    })()
  )
})

/** Asks the page (which asks the database worker) for a file's contents. */
async function fromDevice(event, url) {
  const client = (event.clientId && (await self.clients.get(event.clientId))) || (await self.clients.matchAll({ type: 'window' }))[0]
  if (!client) return new Response('Open Plannr first', { status: 503 })
  const channel = new MessageChannel()
  const reply = new Promise((resolve) => {
    channel.port1.onmessage = (m) => resolve(m.data)
    setTimeout(() => resolve(null), 20000)
  })
  client.postMessage({ type: 'plannr-file', path: url.pathname }, [channel.port2])
  const file = await reply
  if (!file) return new Response('Not found (it may still be downloading)', { status: 404 })
  return new Response(file.data, {
    headers: {
      'Content-Type': file.mime || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name || 'file')}`,
      'Cache-Control': 'no-store'
    }
  })
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  if (url.pathname.startsWith('/plannr-file/') || url.pathname.startsWith('/plannr-vault/')) return event.respondWith(fromDevice(event, url))
  if (url.pathname.startsWith('/api/')) return
  if (event.request.mode === 'navigate') {
    // The newest page when online; the saved one when not.
    return event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/'))
    )
  }
  // Built files have their content's hash in the name, so a saved copy is always right.
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest'))) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(event.request, copy))
          }
          return res
        })
    )
  )
})
