import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck, BookOpen, CalendarClock, Check, ExternalLink, Film, Gamepad2, MessageSquare, Play, Plus, Podcast, Radio, RefreshCw, Search, Shuffle, Star, Trash2, Tv, X, MonitorPlay as Youtube, Sparkles } from 'lucide-react'
import type { DiscoverItem, DiscoverSection, DiscoverTab, EntChannel, EntFeed, EntVideo, MediaItem, MediaKind, MediaPatch, MediaResult, MediaStatus, PodcastResult } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { formatDay, relativeTime, todayISO } from '../lib/format'
import { showToast } from '../lib/toast'
import { go } from '../store/nav'
import { parseIdeas, type Idea } from '../../../shared/ideas'

type Tab = 'watch' | MediaKind | 'podcast' | 'reddit' | 'saved'
const TABS: { id: Tab; label: string; icon: typeof Film }[] = [
  { id: 'watch', label: 'Videos & live', icon: Youtube },
  { id: 'show', label: 'Shows', icon: Tv },
  { id: 'movie', label: 'Movies', icon: Film },
  { id: 'book', label: 'Books', icon: BookOpen },
  { id: 'game', label: 'Games', icon: Gamepad2 },
  { id: 'podcast', label: 'Podcasts', icon: Podcast },
  { id: 'reddit', label: 'Reddit', icon: MessageSquare },
  { id: 'saved', label: 'Watch later', icon: Bookmark }
]

const WORDS: Record<MediaKind, { noun: string; plural: string; want: string; doing: string; done: string; example: string }> = {
  movie: { noun: 'movie', plural: 'movies', want: 'Want to watch', doing: 'Watching', done: 'Watched', example: 'e.g. Dune' },
  show: { noun: 'show', plural: 'shows', want: 'Want to watch', doing: 'Watching', done: 'Finished', example: 'e.g. Severance' },
  book: { noun: 'book', plural: 'books', want: 'Want to read', doing: 'Reading', done: 'Read', example: 'e.g. Project Hail Mary' },
  game: { noun: 'game', plural: 'games', want: 'Want to play', doing: 'Playing', done: 'Finished', example: 'e.g. Hollow Knight' }
}
const statusLabel = (kind: MediaKind, s: MediaStatus): string => (s === 'dropped' ? 'Gave up' : WORDS[kind][s])
const STATUS_ORDER: Record<MediaStatus, number> = { doing: 0, want: 1, done: 2, dropped: 3 }

const errText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback)
const has = (q: string, ...texts: string[]): boolean => !q || texts.some((t) => t.toLowerCase().includes(q.toLowerCase()))
const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

interface VideoActions {
  open: (v: EntVideo) => void
  save: (v: EntVideo) => void
  play: (v: EntVideo) => void
}

/**
 * Everything you watch, read, play and listen to: new videos and who's live, your shows (with new episode dates),
 * movies, books and games (lists, ratings, progress), podcasts (played right here), subreddits, and Watch later.
 */
export function EntertainmentView() {
  const [feed, setFeed] = useState<EntFeed | null>(null)
  const [media, setMedia] = useState<MediaItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [manage, setManage] = useState(false)
  const [playing, setPlaying] = useState<EntVideo | null>(null)
  const [web, setWeb] = useState(false)
  const tab = (useUi((s) => s.prefs.entTab) as Tab | undefined) ?? 'watch'
  const setPref = useUi((s) => s.setPref)

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
    void api.app.info().then((i) => alive && setWeb(i.web))
    void api.entertainment.feed().then((f) => {
      if (!alive) return
      setFeed(f)
      if (f.channels.length && (!f.refreshedAt || Date.now() - f.refreshedAt > 5 * 60_000)) void refresh()
    })
    void api.media.list().then((m) => {
      if (!alive) return
      setMedia(m)
      void api.media.refresh().then((x) => alive && setMedia(x))
    })
    const timer = setInterval(() => void api.entertainment.feed().then((f) => alive && setFeed(f)), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  const patchVideo = (id: string, patch: Partial<EntVideo>): void => setFeed((f) => (f ? { ...f, videos: f.videos.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : f))
  const watched = (v: EntVideo): void => {
    if (v.watched) return
    patchVideo(v.id, { watched: true })
    void api.entertainment.markWatched(v.id, true)
  }
  const actions: VideoActions = {
    open: (v) => {
      if (v.url) window.open(v.url, '_blank')
      watched(v)
    },
    save: (v) => {
      patchVideo(v.id, { saved: !v.saved })
      void api.entertainment.save(v.id, !v.saved)
      showToast(v.saved ? 'Removed from Watch later' : 'Saved to Watch later')
    },
    play: (v) => {
      setPlaying(v)
      watched(v)
    }
  }

  if (!feed || !media) return <div className="page ent-page" />
  const saved = feed.videos.filter((v) => v.saved)
  const channelKinds: Partial<Record<Tab, EntChannel['kind'][]>> = { watch: ['youtube', 'twitch'], podcast: ['podcast'], reddit: ['reddit'] }
  const manageable = channelKinds[tab]
  const tabChannels = manageable ? feed.channels.filter((c) => manageable.includes(c.kind)) : []

  return (
    <div className={`page ent-page ${playing ? 'with-player' : ''}`}>
      <div className="list-header">
        <h1>Entertainment</h1>
        <span className="muted small">{busy ? 'Checking…' : feed.refreshedAt ? `Updated ${relativeTime(feed.refreshedAt).toLowerCase()}` : ''}</span>
        <div className="news-header-actions">
          <label className="news-search">
            <Search />
            <input value={query} placeholder="Search" aria-label="Search entertainment" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="icon-btn" aria-label="Check now" title="Check now" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={busy ? 'spin' : ''} />
          </button>
          {tabChannels.length > 0 && (
            <button type="button" className={`btn sm ${manage ? 'active-btn' : ''}`} onClick={() => setManage((m) => !m)}>
              {tab === 'reddit' ? 'Subreddits' : tab === 'podcast' ? 'Following' : 'Channels'}
            </button>
          )}
        </div>
      </div>

      <div className="ent-tabs" role="tablist" aria-label="Entertainment">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setPref('entTab', t.id)}>
            <t.icon /> {t.label}
            {t.id === 'saved' && saved.length > 0 && <span className="ent-tab-count">{saved.length}</span>}
          </button>
        ))}
      </div>

      {manage && tabChannels.length > 0 && (
        <section className="card ent-manage">
          <ul>
            {tabChannels.map((c) => (
              <li key={c.id}>
                {c.kind === 'youtube' ? <Youtube /> : c.kind === 'twitch' ? <Tv /> : c.kind === 'reddit' ? <MessageSquare /> : <Podcast />}
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
          {tab === 'watch' && <WatchSettings />}
        </section>
      )}

      {tab === 'watch' && <WatchTab feed={feed} setFeed={setFeed} busy={busy} q={query} actions={actions} />}
      {(tab === 'show' || tab === 'movie' || tab === 'book' || tab === 'game') && <MediaShelf key={tab} kind={tab} items={media} setItems={(f) => setMedia((m) => (m ? f(m) : m))} q={query} web={web} />}
      {tab === 'podcast' && <PodcastTab feed={feed} setFeed={setFeed} q={query} actions={actions} />}
      {tab === 'reddit' && <RedditTab feed={feed} setFeed={setFeed} q={query} actions={actions} />}
      {tab === 'saved' && (
        <section className="ent-section">
          {saved.length === 0 ? (
            <div className="empty-state">
              <p>Click the bookmark on any video, Reddit post or podcast episode to keep it here for later.</p>
            </div>
          ) : (
            <div className="ent-feed-list">
              {saved.filter((v) => has(query, v.title, v.channelName)).map((v) => (v.kind === 'youtube' ? <VideoCard key={v.id} v={v} actions={actions} wide /> : v.kind === 'podcast' ? <EpisodeRow key={v.id} v={v} actions={actions} /> : <PostCard key={v.id} v={v} actions={actions} />))}
            </div>
          )}
        </section>
      )}

      {playing && <PodcastPlayer item={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}

// ---------- Videos and live ----------

function WatchSettings() {
  const showShorts = useUi((s) => s.prefs.entShorts === '1')
  const setPref = useUi((s) => s.setPref)
  const [notifyLive, setNotifyLive] = useState(false)
  useEffect(() => {
    void api.settings.get('ent.notifyLive').then((v) => setNotifyLive(v === true))
  }, [])
  return (
    <>
      <label className="check-row">
        <input type="checkbox" checked={showShorts} onChange={(e) => setPref('entShorts', e.target.checked ? '1' : '')} /> Show YouTube Shorts
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={notifyLive}
          onChange={(e) => {
            setNotifyLive(e.target.checked)
            void api.settings.set('ent.notifyLive', e.target.checked)
          }}
        />{' '}
        Notify me when a streamer goes live
      </label>
    </>
  )
}

function WatchTab({ feed, setFeed, busy, q, actions }: { feed: EntFeed; setFeed: (f: EntFeed) => void; busy: boolean; q: string; actions: VideoActions }) {
  const [input, setInput] = useState('')
  const [kind, setKind] = useState<'youtube' | 'twitch'>('youtube')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [channel, setChannel] = useState('all')
  const showShorts = useUi((s) => s.prefs.entShorts === '1')
  const hideWatched = useUi((s) => s.prefs.entHideWatched === '1')
  const setPref = useUi((s) => s.setPref)

  const add = async (): Promise<void> => {
    if (!input.trim()) return
    setError('')
    setAdding(true)
    try {
      setFeed(await api.entertainment.add(input, /twitch\.tv/i.test(input) ? 'twitch' : /youtube\.com|youtu\.be/i.test(input) ? 'youtube' : kind))
      setInput('')
    } catch (e) {
      setError(errText(e, 'Couldn’t add that'))
    } finally {
      setAdding(false)
    }
  }
  const live = feed.live.filter((l) => l.live)
  const offline = feed.live.filter((l) => !l.live)
  const youtube = feed.channels.filter((c) => c.kind === 'youtube')
  const [mode, setMode] = useMode('watch', !feed.channels.some((c) => c.kind === 'youtube' || c.kind === 'twitch'))
  const videos = feed.videos.filter((v) => v.kind === 'youtube' && (showShorts || !v.short) && (channel === 'all' || v.channelId === channel) && (!hideWatched || !v.watched) && has(q, v.title, v.channelName))

  return (
    <>
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
        <button type="submit" className="btn" disabled={adding || busy}>
          <Plus /> Add
        </button>
      </form>
      {error && <p className="small danger-text">{error}</p>}
      <ModeSwitch mode={mode} setMode={setMode} list="Following" />
      {mode === 'discover' ? (
        <Discover tab="watch" onFeed={setFeed} />
      ) : (
        <>
      {feed.channels.filter((c) => c.kind === 'youtube' || c.kind === 'twitch').length === 0 && (
        <div className="empty-state welcome">
          <p>Add the YouTube channels and Twitch streamers you watch. New videos show here, and you’ll see who’s live.</p>
          <p className="small muted">YouTube: paste the channel’s link (or its @handle). Twitch: type the streamer’s name.</p>
        </div>
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
                  setFeed({ ...feed, videos: feed.videos.map((v) => (unwatched.includes(v) ? { ...v, watched: true } : v)) })
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
              <VideoCard key={v.id} v={v} actions={actions} />
            ))}
          </div>
          {videos.length === 0 && <p className="muted small">No videos yet{busy ? ' – checking…' : '.'}</p>}
        </section>
      )}
        </>
      )}
    </>
  )
}

function SaveButton({ v, actions }: { v: EntVideo; actions: VideoActions }) {
  return (
    <button type="button" className={`icon-btn sm ent-save ${v.saved ? 'on' : ''}`} aria-label={v.saved ? 'Remove from Watch later' : 'Watch later'} title={v.saved ? 'Remove from Watch later' : 'Watch later'} onClick={() => actions.save(v)}>
      {v.saved ? <BookmarkCheck /> : <Bookmark />}
    </button>
  )
}

function VideoCard({ v, actions, wide }: { v: EntVideo; actions: VideoActions; wide?: boolean }) {
  return (
    <div className={`ent-video ${v.watched ? 'watched' : ''} ${wide ? 'wide' : ''}`}>
      <button type="button" className="ent-video-open" onClick={() => actions.open(v)}>
        {v.image && <img src={v.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <b className="ent-clamp">{v.title}</b>
        <span className="small muted">
          {v.channelName} · {relativeTime(v.publishedAt)}
          {v.short ? ' · Short' : ''}
        </span>
      </button>
      <SaveButton v={v} actions={actions} />
    </div>
  )
}

// ---------- Reddit ----------

function PostCard({ v, actions }: { v: EntVideo; actions: VideoActions }) {
  return (
    <div className={`ent-post ${v.watched ? 'watched' : ''}`}>
      <button type="button" className="ent-post-open" onClick={() => actions.open(v)}>
        {v.image && <img src={v.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <span className="ent-post-text">
          <span className="small muted">
            {v.channelName} · {relativeTime(v.publishedAt)}
          </span>
          <b className="ent-clamp">{v.title}</b>
          {v.summary && <span className="small muted ent-clamp">{v.summary}</span>}
        </span>
      </button>
      <SaveButton v={v} actions={actions} />
    </div>
  )
}

function RedditTab({ feed, setFeed, q, actions }: { feed: EntFeed; setFeed: (f: EntFeed) => void; q: string; actions: VideoActions }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [which, setWhich] = useState('all')
  const hideRead = useUi((s) => s.prefs.entHideRead === '1')
  const setPref = useUi((s) => s.setPref)
  const subs = feed.channels.filter((c) => c.kind === 'reddit')
  const [mode, setMode] = useMode('reddit', subs.length === 0)
  const posts = feed.videos.filter((v) => v.kind === 'reddit' && (which === 'all' || v.channelId === which) && (!hideRead || !v.watched) && has(q, v.title, v.summary, v.channelName))
  const add = async (): Promise<void> => {
    if (!input.trim()) return
    setError('')
    setAdding(true)
    try {
      setFeed(await api.entertainment.add(input, 'reddit'))
      setInput('')
    } catch (e) {
      setError(errText(e, 'Couldn’t add that subreddit'))
    } finally {
      setAdding(false)
    }
  }
  return (
    <>
      <form
        className="ent-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Subreddit to add" placeholder="A subreddit, e.g. pcmasterrace (or its link)" />
        <button type="submit" className="btn" disabled={adding}>
          <Plus /> Add subreddit
        </button>
      </form>
      {error && <p className="small danger-text">{error}</p>}
      <ModeSwitch mode={mode} setMode={setMode} list="Following" />
      {mode === 'discover' ? (
        <Discover tab="reddit" onFeed={setFeed} />
      ) : subs.length === 0 ? (
        <div className="empty-state welcome">
          <p>Follow subreddits and see each one’s top posts of the day here, with pictures. No Reddit account needed.</p>
        </div>
      ) : (
        <section className="ent-section">
          <div className="news-tabs">
            {subs.length > 1 && (
              <button type="button" className={`chip-btn ${which === 'all' ? 'active' : ''}`} onClick={() => setWhich('all')}>
                All
              </button>
            )}
            {subs.length > 1 &&
              subs.map((c) => (
                <button key={c.id} type="button" className={`chip-btn ${which === c.id ? 'active' : ''}`} onClick={() => setWhich(c.id)}>
                  {c.name}
                </button>
              ))}
            <button type="button" className={`btn sm ent-push ${hideRead ? 'active-btn' : ''}`} aria-pressed={hideRead} onClick={() => setPref('entHideRead', hideRead ? '' : '1')}>
              {hideRead ? 'Showing unread' : 'Hide read'}
            </button>
          </div>
          <div className="ent-feed-list">
            {posts.slice(0, 80).map((v) => (
              <PostCard key={v.id} v={v} actions={actions} />
            ))}
          </div>
          {posts.length === 0 && <p className="muted small">No posts yet. Reddit sometimes asks readers to wait; Plannr tries again every 30 minutes.</p>}
        </section>
      )}
    </>
  )
}

// ---------- Podcasts ----------

function EpisodeRow({ v, actions }: { v: EntVideo; actions: VideoActions }) {
  return (
    <div className={`ent-episode ${v.watched ? 'watched' : ''}`}>
      {v.image && <img src={v.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <div className="ent-episode-text">
        <span className="small muted">
          {v.channelName} · {relativeTime(v.publishedAt)}
        </span>
        <b className="ent-clamp">{v.title}</b>
        {v.summary && <span className="small muted ent-clamp">{v.summary}</span>}
      </div>
      <div className="ent-episode-actions">
        {v.audio && (
          <button type="button" className="btn sm" aria-label={`Play ${v.title}`} onClick={() => actions.play(v)}>
            <Play /> Play
          </button>
        )}
        {v.url && (
          <button type="button" className="icon-btn sm" aria-label="Open the episode’s page" title="Open the episode’s page" onClick={() => actions.open(v)}>
            <ExternalLink />
          </button>
        )}
        <SaveButton v={v} actions={actions} />
      </div>
    </div>
  )
}

function PodcastTab({ feed, setFeed, q, actions }: { feed: EntFeed; setFeed: (f: EntFeed) => void; q: string; actions: VideoActions }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<PodcastResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [which, setWhich] = useState('all')
  const pods = feed.channels.filter((c) => c.kind === 'podcast')
  const [mode, setMode] = useMode('podcast', pods.length === 0)
  const episodes = feed.videos.filter((v) => v.kind === 'podcast' && (which === 'all' || v.channelId === which) && has(q, v.title, v.summary, v.channelName))
  const follow = async (feedUrl: string): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const next = await api.entertainment.add(feedUrl, 'podcast')
      setFeed(next)
      showToast(`Following ${next.channels[next.channels.length - 1]?.name ?? 'the podcast'}`)
    } catch (e) {
      setError(errText(e, 'Couldn’t follow that podcast'))
    } finally {
      setBusy(false)
    }
  }
  const find = async (q = term): Promise<void> => {
    if (!q.trim()) return
    if (/^https?:\/\//i.test(q.trim())) return void follow(q.trim()).then(() => setTerm(''))
    setError('')
    setBusy(true)
    try {
      const r = await api.entertainment.findPodcasts(q)
      setResults(r)
      if (!r.length) setError('No podcasts found by that name')
    } catch (e) {
      setError(errText(e, 'Couldn’t search for podcasts'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <form
        className="ent-add"
        onSubmit={(e) => {
          e.preventDefault()
          void find()
        }}
      >
        <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Podcast to find" placeholder="Find a podcast by name (or paste its feed address)" />
        <button type="submit" className="btn" disabled={busy}>
          <Search /> Find
        </button>
      </form>
      {error && <p className="small danger-text">{error}</p>}
      {results && results.length > 0 && (
        <section className="card ent-results">
          <div className="ent-results-head">
            <b>Podcasts</b>
            <button type="button" className="icon-btn sm" aria-label="Close the results" onClick={() => setResults(null)}>
              <X />
            </button>
          </div>
          {results.map((r) => {
            const following = pods.some((p) => p.handle === r.feedUrl)
            return (
              <div key={r.feedUrl} className="ent-result">
                {r.image && <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div>
                  <b>{r.name}</b>
                  <span className="small muted">{r.author}</span>
                </div>
                <button type="button" className="btn sm" disabled={following || busy} aria-label={following ? `Following ${r.name}` : `Follow ${r.name}`} onClick={() => void follow(r.feedUrl)}>
                  {following ? (
                    <>
                      <Check /> Following
                    </>
                  ) : (
                    'Follow'
                  )}
                </button>
              </div>
            )
          })}
        </section>
      )}
      <ModeSwitch mode={mode} setMode={setMode} list="Following" />
      {mode === 'discover' && (
        <Discover
          tab="podcast"
          onFeed={setFeed}
          ideas={{
            noun: 'podcasts',
            prompt: () =>
              `Suggest 8 podcasts I'd probably enjoy.${pods.length ? ` I already listen to: ${pods.map((p) => p.name).join(', ')}.` : ' Pick a varied mix of widely loved ones.'}\nReply with only the list, one per line, in this exact form:\nPodcast name | a short reason\nDon't use any tools.`,
            onFind: (t) => {
              setTerm(t)
              void find(t)
            }
          }}
        />
      )}
      {mode === 'list' && pods.length === 0 && !results && (
        <div className="empty-state welcome">
          <p>Find the podcasts you like and follow them. New episodes show here, and you can listen right in Plannr: it remembers where you stopped.</p>
        </div>
      )}
      {mode === 'list' && pods.length > 0 && (
        <section className="ent-section">
          {pods.length > 1 && (
            <div className="news-tabs">
              <button type="button" className={`chip-btn ${which === 'all' ? 'active' : ''}`} onClick={() => setWhich('all')}>
                All
              </button>
              {pods.map((c) => (
                <button key={c.id} type="button" className={`chip-btn ${which === c.id ? 'active' : ''}`} onClick={() => setWhich(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="ent-feed-list">
            {episodes.slice(0, 80).map((v) => (
              <EpisodeRow key={v.id} v={v} actions={actions} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

const SPEEDS = ['1', '1.25', '1.5', '1.75', '2']

/** Plays a podcast episode at the bottom of the page; remembers where you stopped (on this device) */
function PodcastPlayer({ item, onClose }: { item: EntVideo; onClose: () => void }) {
  const ref = useRef<HTMLAudioElement>(null)
  const speed = useUi((s) => s.prefs.podSpeed) || '1'
  const setPref = useUi((s) => s.setPref)
  const key = `plannr.podpos.${item.id}`
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = Number(speed)
  }, [speed, item.id])
  return (
    <div className="ent-player" role="region" aria-label="Podcast player">
      {item.image && <img src={item.image} alt="" referrerPolicy="no-referrer" />}
      <div className="ent-player-text">
        <b className="ent-clamp1">{item.title}</b>
        <span className="small muted">{item.channelName}</span>
      </div>
      <audio
        key={item.id}
        ref={ref}
        src={item.audio}
        controls
        autoPlay
        preload="metadata"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget
          a.playbackRate = Number(speed)
          try {
            const t = Number(localStorage.getItem(key))
            if (t > 5 && (!a.duration || t < a.duration - 10)) a.currentTime = t
          } catch {
            /* starts from the beginning */
          }
        }}
        onTimeUpdate={(e) => {
          const t = Math.floor(e.currentTarget.currentTime)
          if (t > 0 && t % 5 === 0)
            try {
              localStorage.setItem(key, String(t))
            } catch {
              /* not remembered */
            }
        }}
        onEnded={() => {
          try {
            localStorage.removeItem(key)
          } catch {
            /* nothing to forget */
          }
        }}
      />
      <select className="ent-speed" aria-label="Speed" value={speed} onChange={(e) => setPref('podSpeed', e.target.value)}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <button type="button" className="icon-btn" aria-label="Close the player" onClick={onClose}>
        <X />
      </button>
    </div>
  )
}

// ---------- Movies, shows, books and games ----------

function MediaShelf({ kind, items, setItems, q, web }: { kind: MediaKind; items: MediaItem[]; setItems: (f: (m: MediaItem[]) => MediaItem[]) => void; q: string; web: boolean }) {
  const w = WORDS[kind]
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<MediaResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | MediaStatus>('all')
  const [open, setOpen] = useState<{ id: string; picked?: boolean } | null>(null)
  const [notifyEpisodes, setNotifyEpisodes] = useState(true)
  useEffect(() => {
    if (kind === 'show') void api.settings.get('ent.notifyEpisodes').then((v) => setNotifyEpisodes(v !== false))
  }, [kind])
  const today = todayISO()
  const mine = items.filter((m) => m.kind === kind)
  const [mode, setMode] = useMode(kind, mine.length === 0)
  const shown = mine
    .filter((m) => (filter === 'all' || m.status === filter) && has(q, m.title, m.subtitle, m.notes))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.finishedOn ?? '').localeCompare(a.finishedOn ?? '') || b.createdAt - a.createdAt)
  const statuses: MediaStatus[] = kind === 'movie' ? ['want', 'done'] : ['want', 'doing', 'done', 'dropped']
  const year = today.slice(0, 4)
  const finished = mine.filter((m) => m.status === 'done' && m.finishedOn?.startsWith(year))
  const rated = mine.filter((m) => m.rating > 0)
  const pages = kind === 'book' ? finished.reduce((n, m) => n + m.total, 0) : 0
  const upcoming =
    kind === 'show'
      ? mine
          .filter((m) => m.status !== 'dropped')
          .flatMap((m) => m.episodes.filter((e) => e.date >= today && e.date <= addDays(today, 60)).map((e) => ({ m, e })))
          .sort((a, b) => a.e.date.localeCompare(b.e.date))
          .slice(0, 6)
      : []

  const update = (item: MediaItem): void => setItems((list) => list.map((m) => (m.id === item.id ? item : m)))
  const search = async (q = term): Promise<void> => {
    if (!q.trim()) return
    setError('')
    setBusy(true)
    try {
      const r = await api.media.search(kind, q)
      setResults(r)
      if (!r.length) setError(`Nothing found. You can still add “${q.trim()}” by name.`)
    } catch (e) {
      setResults([])
      setError(`${errText(e, 'Couldn’t look that up')}. You can still add it by name.`)
    } finally {
      setBusy(false)
    }
  }
  const add = async (r: MediaResult | { kind: MediaKind; title: string }): Promise<void> => {
    try {
      const item = await api.media.add(r)
      setItems((list) => [item, ...list])
      showToast(`Added ${item.title}`, { label: 'Open', run: () => setOpen({ id: item.id }) })
    } catch (e) {
      showToast(errText(e, 'Couldn’t add that'))
    }
  }
  const pick = (): void => {
    const pool = mine.filter((m) => m.status === 'want')
    if (!pool.length) return showToast(`Nothing on your “${w.want}” list yet`)
    setOpen({ id: pool[Math.floor(Math.random() * pool.length)].id, picked: true })
  }
  const openItem = open ? items.find((m) => m.id === open.id) : undefined

  return (
    <>
      <form
        className="ent-add"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`Find a ${w.noun}`} placeholder={`Find a ${w.noun} to add (${w.example})`} />
        <button type="submit" className="btn" disabled={busy}>
          <Search /> Find
        </button>
      </form>
      {error && <p className="small muted">{error}</p>}
      {results && (
        <section className="card ent-results">
          <div className="ent-results-head">
            <b>Add a {w.noun}</b>
            {term.trim() && (
              <button type="button" className="link-btn small" onClick={() => void add({ kind, title: term })}>
                Add “{term.trim()}” without looking it up
              </button>
            )}
            <button type="button" className="icon-btn sm" aria-label="Close the results" onClick={() => setResults(null)}>
              <X />
            </button>
          </div>
          {results.map((r) => {
            const added = mine.some((m) => m.extId && m.extId === r.extId)
            return (
              <div key={r.extId} className="ent-result">
                {r.image ? <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" className={kind === 'game' ? 'wide' : ''} /> : <span className="media-cover-empty">{r.title.slice(0, 1)}</span>}
                <div>
                  <b>{r.title}</b>
                  <span className="small muted">{r.subtitle}</span>
                </div>
                <button type="button" className="btn sm" disabled={added} aria-label={`Add ${r.title}${r.year ? ` (${r.year})` : ""}`} onClick={() => void add(r)}>
                  {added ? (
                    <>
                      <Check /> On your list
                    </>
                  ) : (
                    <>
                      <Plus /> Add
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </section>
      )}

      <ModeSwitch mode={mode} setMode={setMode} list={`My ${w.plural}`} />
      {mode === 'discover' && (
        <Discover
          tab={kind}
          onMedia={(m) => setItems((list) => [m, ...list])}
          ideas={{
            noun: w.plural,
            prompt: () => {
              const had = mine.filter((m) => m.status !== 'want').slice(0, 40).map((m) => `${m.title}${m.year ? ` (${m.year})` : ''}: ${statusLabel(kind, m.status).toLowerCase()}${m.rating ? `, ${m.rating}/5` : ''}`)
              const want = mine.filter((m) => m.status === 'want').slice(0, 25).map((m) => m.title)
              return `Suggest 8 ${w.plural} I'd probably enjoy that aren't on my lists.${had.length ? `\nWhat I've already got to, and how I rated them:\n${had.join('\n')}` : ''}${want.length ? `\nAlready on my list: ${want.join(', ')}` : ''}${!had.length && !want.length ? '\nI haven\'t added any yet, so pick a varied mix of widely loved ones.' : ''}\nReply with only the list, one per line, in this exact form:\nTitle (Year) | a short reason\nDon't use any tools.`
            },
            onFind: (t) => {
              setTerm(t)
              void search(t)
            }
          }}
        />
      )}
      {mode === 'list' && (
        <>
      {mine.length === 0 && !results && (
        <div className="empty-state welcome">
          <p>
            Keep track of the {w.plural} you want to get to, what you’re in the middle of, and what you thought of them.
            {kind === 'show' ? ' Plannr shows when new episodes come out, and puts them on your calendar.' : ''}
            {kind === 'book' ? ' Keep your place with the page you’re on.' : ''}
          </p>
        </div>
      )}

      {mine.length > 0 && (
        <>
          <div className="media-bar">
            <div className="news-tabs">
              <button type="button" className={`chip-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
                All <span className="muted">{mine.length}</span>
              </button>
              {statuses.map((s) => {
                const n = mine.filter((m) => m.status === s).length
                return n || s !== 'dropped' ? (
                  <button key={s} type="button" className={`chip-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                    {statusLabel(kind, s)} <span className="muted">{n}</span>
                  </button>
                ) : null
              })}
            </div>
            <button type="button" className="btn sm" onClick={pick}>
              <Shuffle /> Pick for me
            </button>
          </div>
          <p className="small muted media-stats">
            {finished.length} {finished.length === 1 ? w.noun : w.plural} finished this year
            {pages > 0 && ` · ${pages.toLocaleString()} pages`}
            {rated.length > 0 && ` · average ${(rated.reduce((n, m) => n + m.rating, 0) / rated.length).toFixed(1)} ★`}
          </p>
        </>
      )}

      {upcoming.length > 0 && (
        <section className="card media-upcoming">
          <h2 className="section-title">
            <CalendarClock /> New episodes coming up
          </h2>
          {upcoming.map(({ m, e }) => (
            <button key={`${m.id}:${e.s}x${e.e}`} type="button" className="media-upcoming-row" onClick={() => setOpen({ id: m.id })}>
              <span className="media-upcoming-date">{e.date === today ? 'Today' : formatDay(e.date)}</span>
              <b>{m.title}</b>
              <span className="small muted">
                S{e.s} E{e.e}
                {e.name ? ` · ${e.name}` : ''}
              </span>
            </button>
          ))}
        </section>
      )}

      <div className={`media-grid ${kind}`}>
        {shown.map((m) => (
          <MediaCard key={m.id} m={m} today={today} onOpen={() => setOpen({ id: m.id })} onChange={update} />
        ))}
      </div>
      {mine.length > 0 && shown.length === 0 && <p className="muted small">Nothing here.</p>}

      {kind === 'show' && mine.length > 0 && !web && (
        <label className="check-row media-notify">
          <input
            type="checkbox"
            checked={notifyEpisodes}
            onChange={(e) => {
              setNotifyEpisodes(e.target.checked)
              void api.settings.set('ent.notifyEpisodes', e.target.checked)
            }}
          />{' '}
          Notify me the day a new episode of one of my shows comes out
        </label>
      )}
        </>
      )}

      {openItem && (
        <MediaDialog
          item={openItem}
          picked={open?.picked}
          onChange={update}
          onClose={() => setOpen(null)}
          onRemove={() => {
            void api.media.remove(openItem.id)
            setItems((list) => list.filter((m) => m.id !== openItem.id))
            setOpen(null)
            showToast(`Removed ${openItem.title}`)
          }}
        />
      )}
    </>
  )
}

const airedOf = (m: MediaItem, today: string) => m.episodes.filter((e) => e.date && e.date <= today)

function MediaCard({ m, today, onOpen, onChange }: { m: MediaItem; today: string; onOpen: () => void; onChange: (m: MediaItem) => void }) {
  const aired = m.kind === 'show' ? airedOf(m, today) : []
  const next = m.kind === 'show' && m.status === 'doing' ? aired[m.progress] : undefined
  const pct = m.total > 0 && (m.kind === 'book' || m.kind === 'show') && m.status === 'doing' ? Math.min(100, Math.round((m.progress / m.total) * 100)) : null
  return (
    <div className={`media-card s-${m.status}`}>
      <button type="button" className="media-open" onClick={onOpen} aria-label={m.title}>
        <span className="media-cover">
          {m.image ? <img src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="media-cover-empty">{m.title.slice(0, 1)}</span>}
          {m.status !== 'want' && <span className={`media-badge s-${m.status}`}>{statusLabel(m.kind, m.status)}</span>}
          {m.kind === 'show' && m.nextEpisode && <span className="media-badge next">New ep. {formatDay(m.nextEpisode.date)}</span>}
        </span>
        <b className="ent-clamp">{m.title}</b>
        <span className="small muted ent-clamp1">{m.subtitle}</span>
        {m.rating > 0 && <span className="media-stars" aria-label={`${m.rating} stars`}>{'★'.repeat(m.rating)}</span>}
        {pct !== null && (
          <span className="media-bar-track" title={`${pct}%`}>
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      {next && (
        <button type="button" className="btn sm media-next" title={next.name} onClick={() => void api.media.update(m.id, { progress: m.progress + 1 }).then(onChange)}>
          <Check /> Watched S{next.s} E{next.e}
        </button>
      )}
    </div>
  )
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="media-rate" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= value ? 'on' : ''} onClick={() => onChange(n === value ? 0 : n)}>
          <Star />
        </button>
      ))}
    </span>
  )
}

/** A number saved when you leave the box (or press Enter) */
function NumberBox({ value, label, onSave }: { value: number; label: string; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value || ''))
  useEffect(() => setText(String(value || '')), [value])
  const commit = (): void => {
    const n = Math.max(0, Math.round(Number(text) || 0))
    if (n !== value) onSave(n)
  }
  return <input type="number" min={0} className="media-num" aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
}

function MediaDialog({ item, picked, onChange, onClose, onRemove }: { item: MediaItem; picked?: boolean; onChange: (m: MediaItem) => void; onClose: () => void; onRemove: () => void }) {
  const w = WORDS[item.kind]
  const [notes, setNotes] = useState(item.notes)
  const save = async (patch: MediaPatch): Promise<void> => onChange(await api.media.update(item.id, patch))
  const statuses: MediaStatus[] = item.kind === 'movie' ? ['want', 'done'] : ['want', 'doing', 'done', 'dropped']
  const today = todayISO()
  const aired = item.kind === 'show' ? airedOf(item, today) : []
  const next = aired[item.progress]
  const pct = item.total > 0 ? Math.min(100, Math.round((item.progress / item.total) * 100)) : 0
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog media-dialog" role="dialog" aria-label={item.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="media-dialog-top">
          {item.image ? <img src={item.image} alt="" referrerPolicy="no-referrer" className={item.kind === 'game' ? 'wide' : ''} /> : <span className="media-cover-empty big">{item.title.slice(0, 1)}</span>}
          <div className="media-dialog-head">
            {picked && <div className="media-picked">How about this one?</div>}
            <h2>{item.title}</h2>
            {item.subtitle && <div className="muted small">{item.subtitle}</div>}
            {item.genres.length > 0 && (
              <div className="media-genres">
                {item.genres.map((g) => (
                  <span key={g}>{g}</span>
                ))}
              </div>
            )}
            <div className="segmented media-status" role="radiogroup" aria-label="Status">
              {statuses.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={item.status === s} className={item.status === s ? 'active' : ''} onClick={() => void save({ status: s })}>
                  {statusLabel(item.kind, s)}
                </button>
              ))}
            </div>
            <Stars value={item.rating} onChange={(n) => void save({ rating: n })} />
          </div>
          <button type="button" className="icon-btn media-close" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        {item.summary && <p className="media-summary">{item.summary}</p>}

        {item.kind === 'book' && (
          <div className="media-progress">
            <span>
              On page <NumberBox value={item.progress} label="Page you’re on" onSave={(n) => void save({ progress: n })} /> of <NumberBox value={item.total} label="Pages" onSave={(n) => void save({ total: n })} />
            </span>
            {item.total > 0 && (
              <span className="media-bar-track wide">
                <span style={{ width: `${pct}%` }} />
              </span>
            )}
          </div>
        )}
        {item.kind === 'show' && aired.length > 0 && (
          <div className="media-progress">
            <label>
              Watched up to{' '}
              <select aria-label="Watched up to" value={Math.min(item.progress, aired.length)} onChange={(e) => void save({ progress: Number(e.target.value) })}>
                <option value={0}>Not started</option>
                {aired.map((e, i) => (
                  <option key={`${e.s}x${e.e}`} value={i + 1}>
                    S{e.s} E{e.e}
                    {e.name ? ` · ${e.name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {next ? (
              <button type="button" className="btn sm" onClick={() => void save({ progress: item.progress + 1 })}>
                <Check /> Watched S{next.s} E{next.e}
              </button>
            ) : (
              <span className="small muted">All caught up</span>
            )}
            <span className="small muted">{Math.max(0, aired.length - item.progress)} to go</span>
          </div>
        )}
        {item.nextEpisode && (
          <p className="small media-next-ep">
            <CalendarClock /> Next episode: S{item.nextEpisode.s} E{item.nextEpisode.e}
            {item.nextEpisode.name ? ` · ${item.nextEpisode.name}` : ''} · {formatDay(item.nextEpisode.date)}
          </p>
        )}

        <label className="mfield">
          Notes
          <textarea rows={3} aria-label="Notes" value={notes} placeholder={item.status === 'done' ? 'What did you think?' : 'Who recommended it, where to watch it…'} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== item.notes && void save({ notes })} />
        </label>
        <div className="media-dates">
          {item.kind !== 'movie' && (
            <label>
              Started
              <input type="date" aria-label="Started" value={item.startedOn ?? ''} onChange={(e) => void save({ startedOn: e.target.value || null })} />
            </label>
          )}
          <label>
            {item.kind === 'movie' ? 'Watched on' : 'Finished'}
            <input type="date" aria-label="Finished" value={item.finishedOn ?? ''} onChange={(e) => void save({ finishedOn: e.target.value || null })} />
          </label>
        </div>
        <div className="media-dialog-foot">
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="btn sm">
              <ExternalLink /> More about this {w.noun}
            </a>
          )}
          <button type="button" className="btn sm danger" onClick={onRemove}>
            <Trash2 /> Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Discover ----------

type Mode = 'list' | 'discover'

/** My list or Discover, remembered per tab on this device (Discover first while the list is empty) */
function useMode(tab: string, empty: boolean): [Mode, (m: Mode) => void] {
  const pref = useUi((s) => s.prefs[`entMode.${tab}`]) as Mode | undefined
  const setPref = useUi((s) => s.setPref)
  return [pref === 'list' || pref === 'discover' ? pref : empty ? 'discover' : 'list', (m) => setPref(`entMode.${tab}`, m)]
}

function ModeSwitch({ mode, setMode, list }: { mode: Mode; setMode: (m: Mode) => void; list: string }) {
  return (
    <div className="segmented ent-mode" role="radiogroup" aria-label="Show">
      <button type="button" role="radio" aria-checked={mode === 'list'} className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>
        {list}
      </button>
      <button type="button" role="radio" aria-checked={mode === 'discover'} className={mode === 'discover' ? 'active' : ''} onClick={() => setMode('discover')}>
        <Sparkles /> Discover
      </button>
    </div>
  )
}

const SHAPE: Record<DiscoverTab, string> = { movie: 'poster', show: 'poster', book: 'poster', game: 'wide', podcast: 'square', reddit: 'round', watch: 'round' }

function Discover({ tab, onMedia, onFeed, ideas }: { tab: DiscoverTab; onMedia?: (m: MediaItem) => void; onFeed?: (f: EntFeed) => void; ideas?: IdeasProps }) {
  const [sections, setSections] = useState<DiscoverSection[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const setPref = useUi((s) => s.setPref)
  const load = useCallback(
    async (refresh = false) => {
      setBusy(true)
      setError('')
      try {
        setSections(await api.discover.list(tab, refresh))
      } catch (e) {
        setError(errText(e, 'Couldn’t load suggestions'))
      } finally {
        setBusy(false)
      }
    },
    [tab]
  )
  useEffect(() => {
    void load()
  }, [load])
  const keyOf = (i: DiscoverItem): string => i.media?.extId ?? i.feedUrl ?? i.channel?.input ?? i.title
  const add = async (i: DiscoverItem): Promise<void> => {
    const key = keyOf(i)
    setAdded((s) => new Set(s).add(key))
    setPref(`entMode.${tab}`, 'discover') // stay here while discovering
    try {
      if (i.media) {
        const m = await api.media.add(i.media)
        onMedia?.(m)
        showToast(`Added ${m.title} to your list`)
      } else if (i.feedUrl) {
        onFeed?.(await api.entertainment.add(i.feedUrl, 'podcast'))
        showToast(`Following ${i.title}`)
      } else if (i.channel) {
        onFeed?.(await api.entertainment.add(i.channel.input, i.channel.kind))
        showToast(`Added ${i.title}`)
      }
    } catch (e) {
      setAdded((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
      showToast(errText(e, 'Couldn’t add that'))
    }
  }
  const verb = (i: DiscoverItem): string => (i.feedUrl ? 'Follow' : 'Add')
  return (
    <div className="disc">
      {ideas && <Ideas {...ideas} />}
      {busy && !sections && <p className="muted small">Finding things for you…</p>}
      {error && (
        <p className="small danger-text">
          {error}.{' '}
          <button type="button" className="link-btn" onClick={() => void load(true)}>
            Try again
          </button>
        </p>
      )}
      {sections?.map((s) => {
        const open = expanded.has(s.id)
        const limit = SHAPE[tab] === 'wide' ? 8 : 12
        return (
          <section key={s.id} className="disc-section" aria-label={s.title}>
            <div className="disc-head">
              <h2 className="section-title">{s.title}</h2>
              {s.note && <span className="small muted">{s.note}</span>}
            </div>
            <div className={`disc-grid ${SHAPE[tab]}`}>
              {(open ? s.items : s.items.slice(0, limit)).map((i) => {
                const done = added.has(keyOf(i))
                return (
                  <div key={keyOf(i)} className="disc-card">
                    <a className="disc-cover" href={i.url} target="_blank" rel="noreferrer" title={i.summary || i.title}>
                      {i.image ? <img src={i.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="media-cover-empty">{i.title.replace(/^(r\/|@)/, '').slice(0, 1).toUpperCase()}</span>}
                      {i.badge && <span className="disc-badge">{i.badge}</span>}
                    </a>
                    <b className="ent-clamp" title={i.title}>
                      {i.title}
                    </b>
                    {i.subtitle && <span className="small muted ent-clamp1">{i.subtitle}</span>}
                    <button type="button" className="btn sm disc-add" disabled={done} aria-label={`${verb(i)} ${i.title}`} onClick={() => void add(i)}>
                      {done ? (
                        <>
                          <Check /> {i.feedUrl ? 'Following' : 'Added'}
                        </>
                      ) : (
                        <>
                          <Plus /> {verb(i)}
                        </>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
            {s.items.length > limit && (
              <button type="button" className="link-btn small disc-more" onClick={() => setExpanded((x) => { const n = new Set(x); if (open) n.delete(s.id); else n.add(s.id); return n })}>
                {open ? 'Show fewer' : `Show all ${s.items.length}`}
              </button>
            )}
          </section>
        )
      })}
      {sections && sections.length === 0 && <p className="muted small">Nothing new to suggest right now. You’ve added everything on these lists!</p>}
      {sections && (
        <p className="small muted disc-foot">
          Lists are updated every few hours.{' '}
          <button type="button" className="link-btn" disabled={busy} onClick={() => void load(true)}>
            {busy ? 'Updating…' : 'Update now'}
          </button>
        </p>
      )}
    </div>
  )
}

interface IdeasProps {
  noun: string
  prompt: () => string
  onFind: (title: string) => void
}

/** Suggestions picked for you by the assistant, from what's on your lists */
function Ideas({ noun, prompt, onFind }: IdeasProps) {
  const [state, setState] = useState<{ busy: boolean; error: string; ideas: Idea[] } | null>(null)
  const ask = async (): Promise<void> => {
    setState({ busy: true, error: '', ideas: [] })
    try {
      if (!(await api.assistant.status()).configured) return setState({ busy: false, error: 'setup', ideas: [] })
      const { reply } = await api.assistant.ask([{ role: 'user', text: prompt() }])
      const ideas = parseIdeas(reply)
      setState({ busy: false, error: ideas.length ? '' : 'The assistant didn’t suggest anything. Try again.', ideas })
    } catch (e) {
      setState({ busy: false, error: errText(e, 'The assistant couldn’t answer'), ideas: [] })
    }
  }
  return (
    <section className="card disc-ideas" aria-label="Ideas just for you">
      <div className="disc-ideas-head">
        <Sparkles />
        <div>
          <b>Ideas just for you</b>
          <span className="small muted">The assistant suggests {noun} from what’s on your lists and how you rated them.</span>
        </div>
        <button type="button" className="btn sm" disabled={state?.busy} onClick={() => void ask()}>
          {state?.busy ? 'Thinking…' : state?.ideas.length ? 'More ideas' : 'Get ideas'}
        </button>
      </div>
      {state?.error === 'setup' && (
        <p className="small muted">
          Set up the assistant first (it’s free with a Gemini or Groq key).{' '}
          <button type="button" className="link-btn" onClick={() => go({ view: 'assistant' })}>
            Open the Assistant
          </button>
        </p>
      )}
      {state?.error && state.error !== 'setup' && <p className="small danger-text">{state.error}</p>}
      {state?.ideas.map((i) => (
        <div key={i.title} className="disc-idea">
          <div>
            <b>
              {i.title}
              {i.year ? ` (${i.year})` : ''}
            </b>
            <span className="small muted">{i.reason}</span>
          </div>
          <button type="button" className="btn sm" aria-label={`Find ${i.title}`} onClick={() => onFind(i.title)}>
            <Search /> Find
          </button>
        </div>
      ))}
    </section>
  )
}
