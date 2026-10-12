import { useCallback, useEffect, useState } from 'react'
import { Plus, Radio, RefreshCw, Trash2, Tv, MonitorPlay as Youtube } from 'lucide-react'
import type { EntFeed, EntVideo } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { relativeTime } from '../lib/format'

/** New uploads from your YouTube channels and which of your Twitch streamers are live. */
export function EntertainmentView() {
  const [feed, setFeed] = useState<EntFeed | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [kind, setKind] = useState<'youtube' | 'twitch'>('youtube')
  const [error, setError] = useState('')
  const [channel, setChannel] = useState<string>('all')
  const [manage, setManage] = useState(false)
  const showShorts = useUi((s) => s.prefs.entShorts === '1')
  const hideWatched = useUi((s) => s.prefs.entHideWatched === '1')
  const setPref = useUi((s) => s.setPref)
  const [notifyLive, setNotifyLive] = useState(false)
  useEffect(() => {
    void api.settings.get('ent.notifyLive').then((v) => setNotifyLive(v === true))
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setFeed(await api.entertainment.refresh())
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    let alive = true
    void api.entertainment.feed().then((f) => {
      if (!alive) return
      setFeed(f)
      if (f.channels.length && (!f.refreshedAt || Date.now() - f.refreshedAt > 5 * 60_000)) void refresh()
    })
    const timer = setInterval(() => void api.entertainment.feed().then((f) => alive && setFeed(f)), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  const add = async (): Promise<void> => {
    if (!input.trim()) return
    setError('')
    setBusy(true)
    try {
      setFeed(await api.entertainment.add(input, /twitch\.tv/i.test(input) ? 'twitch' : /youtube\.com|youtu\.be/i.test(input) ? 'youtube' : kind))
      setInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Couldn’t add that')
    } finally {
      setBusy(false)
    }
  }
  const open = (v: EntVideo): void => {
    window.open(v.url, '_blank')
    if (!v.watched) {
      setFeed((f) => (f ? { ...f, videos: f.videos.map((x) => (x.id === v.id ? { ...x, watched: true } : x)) } : f))
      void api.entertainment.markWatched(v.id, true)
    }
  }

  if (!feed) return <div className="page ent-page" />
  const live = feed.live.filter((l) => l.live)
  const offline = feed.live.filter((l) => !l.live)
  const youtube = feed.channels.filter((c) => c.kind === 'youtube')
  const videos = feed.videos.filter((v) => (showShorts || !v.short) && (channel === 'all' || v.channelId === channel) && (!hideWatched || !v.watched))

  return (
    <div className="page ent-page">
      <div className="list-header">
        <h1>Entertainment</h1>
        <span className="muted small">{busy ? 'Checking…' : feed.refreshedAt ? `Updated ${relativeTime(feed.refreshedAt).toLowerCase()}` : ''}</span>
        <div className="news-header-actions">
          <button type="button" className="icon-btn" aria-label="Check now" title="Check now" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={busy ? 'spin' : ''} />
          </button>
          <button type="button" className={`btn sm ${manage ? 'active-btn' : ''}`} onClick={() => setManage((m) => !m)}>
            Channels
          </button>
        </div>
      </div>

      <form
        className="ent-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <div className="segmented" role="radiogroup" aria-label="Add a">
          <button type="button" role="radio" aria-checked={kind === 'youtube'} className={kind === 'youtube' ? 'active' : ''} onClick={() => setKind('youtube')}>
            <Youtube /> YouTube
          </button>
          <button type="button" role="radio" aria-checked={kind === 'twitch'} className={kind === 'twitch' ? 'active' : ''} onClick={() => setKind('twitch')}>
            <Tv /> Twitch
          </button>
        </div>
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Channel to add" placeholder={kind === 'youtube' ? 'YouTube channel link or @handle' : 'Twitch streamer name or link'} />
        <button type="submit" className="btn" disabled={busy}>
          <Plus /> Add
        </button>
      </form>
      {error && <p className="small danger-text">{error}</p>}

      {feed.channels.length === 0 && (
        <div className="empty-state welcome">
          <p>Add the YouTube channels and Twitch streamers you watch. New videos show here, and you’ll see who’s live.</p>
          <p className="small muted">YouTube: paste the channel’s link (or its @handle). Twitch: type the streamer’s name.</p>
        </div>
      )}

      {manage && feed.channels.length > 0 && (
        <section className="card ent-manage">
          <h2 className="section-title">Your channels</h2>
          <ul>
            {feed.channels.map((c) => (
              <li key={c.id}>
                {c.kind === 'youtube' ? <Youtube /> : <Tv />}
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
                {feed.errors.some((e) => e.channelId === c.id) && <span className="small danger-text">couldn’t check</span>}
                <button type="button" className="icon-btn sm" aria-label={`Remove ${c.name}`} onClick={() => void api.entertainment.remove(c.id).then(setFeed)}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
          <label className="check-row">
            <input type="checkbox" checked={showShorts} onChange={(e) => setPref('entShorts', e.target.checked ? '1' : '')} /> Show YouTube Shorts
          </label>
          <label className="check-row">
            <input type="checkbox" checked={notifyLive} onChange={(e) => { setNotifyLive(e.target.checked); void api.settings.set('ent.notifyLive', e.target.checked) }} /> Notify me when a streamer goes live
          </label>
        </section>
      )}

      {feed.live.length > 0 && (
        <section className="ent-section">
          <h2 className="section-title">
            <Radio /> Live now <span className="muted">{live.length}</span>
          </h2>
          {live.length === 0 && <p className="muted small">Nobody you follow is live right now.</p>}
          <div className="ent-live-grid">
            {live.map((l) => (
              <a key={l.channelId} className="ent-live" href={l.url} target="_blank" rel="noreferrer">
                {l.image && <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <span className="ent-live-badge">LIVE</span>
                <b>{l.name}</b>
                <span className="small muted ent-clamp">{l.title}</span>
              </a>
            ))}
          </div>
          {offline.length > 0 && (
            <p className="small muted ent-offline">
              Offline:{' '}
              {offline.map((l, i) => (
                <span key={l.channelId}>
                  {i > 0 && ', '}
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.name}
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      {youtube.length > 0 && (
        <section className="ent-section">
          <h2 className="section-title">
            <Youtube /> New videos
            <span className="ent-video-actions">
              <button type="button" className={`btn sm ${hideWatched ? 'active-btn' : ''}`} aria-pressed={hideWatched} onClick={() => setPref('entHideWatched', hideWatched ? '' : '1')}>
                {hideWatched ? 'Showing unwatched' : 'Hide watched'}
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  const unwatched = videos.filter((v) => !v.watched)
                  setFeed((f) => (f ? { ...f, videos: f.videos.map((v) => (unwatched.includes(v) ? { ...v, watched: true } : v)) } : f))
                  for (const v of unwatched) void api.entertainment.markWatched(v.id, true)
                }}
              >
                Mark all watched
              </button>
            </span>
          </h2>
          {youtube.length > 1 && (
            <div className="news-tabs">
              <button type="button" className={`chip-btn ${channel === 'all' ? 'active' : ''}`} onClick={() => setChannel('all')}>
                All
              </button>
              {youtube.map((c) => (
                <button key={c.id} type="button" className={`chip-btn ${channel === c.id ? 'active' : ''}`} onClick={() => setChannel(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="ent-video-grid">
            {videos.slice(0, 60).map((v) => (
              <button key={v.id} type="button" className={`ent-video ${v.watched ? 'watched' : ''}`} onClick={() => open(v)}>
                {v.image && <img src={v.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <b className="ent-clamp">{v.title}</b>
                <span className="small muted">
                  {v.channelName} · {relativeTime(v.publishedAt)}
                  {v.short ? ' · Short' : ''}
                </span>
              </button>
            ))}
          </div>
          {videos.length === 0 && <p className="muted small">No videos yet{busy ? ' – checking…' : '.'}</p>}
        </section>
      )}
    </div>
  )
}
