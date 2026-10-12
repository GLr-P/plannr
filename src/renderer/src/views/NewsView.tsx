import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  CalendarCheck,
  CalendarPlus,
  CloudSun,
  Cpu,
  ExternalLink,
  EyeOff,
  Flame,
  Gamepad2,
  ListPlus,
  MapPin,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { LOCAL_NEWS_PAGE, NEWS_PRESETS, NEWS_TOPICS, topicsFor, type NewsFeed, type NewsItem, type NewsPage, type NewsPlace, type NewsPrefs, type NewsPreset, type NewsSource, type NewsSourceKind, type NewsTopic } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { useData } from '../store/data'
import { useUi } from '../store/ui'
import { relativeTime, todayISO } from '../lib/format'
import { formatTime } from '../lib/time'
import { showToast, undoToast } from '../lib/toast'

const KIND_LABEL: Record<NewsSourceKind, string> = { rss: 'News feed', page: 'Web page', roads: 'Roads', weather: 'Weather', facebook: 'Facebook page', gamedeals: 'Game deals', freegames: 'Free games' }
const topicLabel = (t: NewsTopic): string => NEWS_TOPICS.find((x) => x.id === t)?.label ?? t

type Tab = 'foryou' | 'saved' | NewsTopic

const whenLabel = (w: NonNullable<NewsItem['when']>): string => {
  const d = new Date(`${w.date}T12:00`)
  const day = w.date === todayISO() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return w.startTime ? `${day} · ${formatTime(w.startTime)}${w.endTime ? `–${formatTime(w.endTime)}` : ''}` : day
}

export function NewsView({ page: startPage }: { page?: string }) {
  const [feed, setFeed] = useState<NewsFeed | null>(null)
  const [busy, setBusy] = useState(false)
  const [pageId, setPageId] = useState<string>(startPage ?? LOCAL_NEWS_PAGE)
  const [tab, setTab] = useState<Tab>('foryou')
  const [query, setQuery] = useState('')
  const [showFiltered, setShowFiltered] = useState(false)
  const [more, setMore] = useState(30)
  const [settings, setSettings] = useState(false)
  const [addingPage, setAddingPage] = useState(false)
  const [adding, setAdding] = useState<NewsItem | null>(null)
  const prefs = useUi((s) => s.prefs)
  const look = { photos: prefs.newsPhotos !== '0', compact: prefs.newsCompact === '1', urgent: prefs.newsUrgent !== '0', coming: prefs.newsComing !== '0' }

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setFeed(await api.news.refresh())
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void api.news.feed().then((f) => {
      if (!alive) return
      setFeed(f)
      // Fetch fresh stories when the stored ones are more than 15 minutes old
      if (f.sources.some((s) => s.enabled && s.kind !== 'facebook') && (!f.refreshedAt || Date.now() - f.refreshedAt > 15 * 60_000)) void refresh()
    })
    const timer = setInterval(() => void api.news.feed().then((f) => alive && setFeed(f)), 5 * 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  const showPage = (id: string): void => {
    setPageId(id)
    setTab('foryou')
    setShowFiltered(false)
    setMore(30)
  }

  const patchItem = (id: string, patch: Partial<NewsItem>): void => setFeed((f) => (f ? { ...f, items: f.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : f))

  const actions: CardActions = {
    open: (item) => {
      if (item.url) window.open(item.url, '_blank')
      if (!item.read) {
        patchItem(item.id, { read: true })
        void api.news.mark(item.id, { read: true })
      }
    },
    save: (item) => {
      patchItem(item.id, { saved: !item.saved })
      void api.news.mark(item.id, { saved: !item.saved })
    },
    hide: (item) => {
      setFeed((f) => (f ? { ...f, items: f.items.filter((i) => i.id !== item.id) } : f))
      void api.news.mark(item.id, { hidden: true })
      undoToast('Story hidden', async () => {
        await api.news.mark(item.id, { hidden: false })
        setFeed(await api.news.feed())
      })
    },
    calendar: (item) => {
      if (item.eventId) go({ view: 'calendar', eventId: item.eventId, date: item.when?.date })
      else setAdding(item)
    },
    task: async (item) => {
      await api.tasks.create({ title: item.title.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, ''), notes: [item.summary, item.url].filter(Boolean).join('\n\n'), dueDate: item.when?.date ?? null })
      void useData.getState().refreshCounts()
      showToast('Added to your tasks', { label: 'Open', run: () => go({ view: 'tasks' }) })
    }
  }

  // The page shown: the local one, or one of yours (Games, PC parts…)
  const page = feed?.pages.find((p) => p.id === pageId) ?? null
  const local = page === null
  const pageSources = feed?.sources.filter((s) => (s.page ?? LOCAL_NEWS_PAGE) === (page?.id ?? LOCAL_NEWS_PAGE)) ?? []
  const pageItems = useMemo(() => feed?.items.filter((i) => i.page === (page?.id ?? LOCAL_NEWS_PAGE)) ?? [], [feed, page])
  const facebook = local ? pageSources.filter((s) => s.kind === 'facebook' && s.enabled) : []
  const weather = local ? (feed?.weather ?? null) : null
  const hideTopics = page ? page.hideTopics : (feed?.prefs.hideTopics ?? [])

  const groups = useMemo(() => {
    if (!feed) return null
    const today = todayISO()
    const q = query.trim().toLowerCase()
    const matches = (i: NewsItem): boolean => !q || `${i.title} ${i.summary} ${i.sourceName}`.toLowerCase().includes(q)
    const visible = pageItems.filter((i) => matches(i) && (showFiltered || !i.filtered))
    const hiddenCount = pageItems.filter((i) => i.filtered && matches(i)).length
    if (tab === 'saved') return { list: visible.filter((i) => i.saved), hiddenCount }
    if (tab !== 'foryou') return { list: pageItems.filter((i) => matches(i) && i.topic === tab), hiddenCount: 0 }
    const urgent = prefs.newsUrgent === '0' ? [] : visible.filter((i) => i.important).slice(0, local ? 8 : 12)
    const coming = visible
      .filter((i) => i.when && i.when.date >= today && !urgent.includes(i))
      .sort((a, b) => (a.when!.date + (a.when!.startTime ?? '')).localeCompare(b.when!.date + (b.when!.startTime ?? '')))
      .slice(0, 10)
    const shown = new Set([...urgent, ...coming].map((i) => i.id))
    return { urgent, coming, latest: visible.filter((i) => !shown.has(i.id)), hiddenCount }
  }, [feed, pageItems, tab, query, showFiltered, prefs.newsUrgent, local])

  if (!feed) return <div className="page news-page" />
  const pageTabs = (
    <div className="news-pages" role="tablist" aria-label="News pages">
      {[{ id: LOCAL_NEWS_PAGE, name: 'Local' }, ...feed.pages].map((p) => (
        <button key={p.id} type="button" role="tab" aria-selected={pageId === p.id || (local && p.id === LOCAL_NEWS_PAGE)} className={pageId === p.id || (local && p.id === LOCAL_NEWS_PAGE) ? 'active' : ''} onClick={() => showPage(p.id)}>
          {p.name}
        </button>
      ))}
      <button type="button" className="news-add-page" title="Add a page: games, PC parts, or your own" aria-label="Add a news page" onClick={() => setAddingPage(true)}>
        <Plus />
      </button>
    </div>
  )
  const addPageDialog = addingPage && (
    <AddPageDialog
      onClose={() => setAddingPage(false)}
      onAdded={(f) => {
        setFeed(f)
        setAddingPage(false)
        showPage(f.pages[f.pages.length - 1]?.id ?? LOCAL_NEWS_PAGE)
      }}
    />
  )
  if (local && pageSources.length === 0)
    return (
      <div className="page news-page">
        {feed.pages.length > 0 && <div className="list-header news-header">{pageTabs}</div>}
        <NewsSetup onDone={setFeed} onAddPage={() => setAddingPage(true)} />
        {addPageDialog}
      </div>
    )

  const topicsWithStories = topicsFor(local).filter((t) => pageItems.some((i) => i.topic === t.id))
  return (
    <div className="page news-page">
      <div className="list-header news-header">
        <h1>News</h1>
        {pageTabs}
        {local && feed.prefs.place && (
          <span className="news-place">
            <MapPin /> {feed.prefs.place.name}
          </span>
        )}
        <span className="news-updated muted small">{busy ? 'Checking for news…' : feed.refreshedAt ? `Updated ${relativeTime(feed.refreshedAt).toLowerCase()}` : ''}</span>
        <div className="news-header-actions">
          <button type="button" className="icon-btn" title="Check for news now" aria-label="Check for news now" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={busy ? 'spin' : ''} />
          </button>
          <button type="button" className="btn sm" onClick={() => setSettings(true)}>
            <Settings2 /> {local ? 'Sources & topics' : 'Page settings'}
          </button>
        </div>
      </div>

      <div className="news-tabs" role="tablist" aria-label="Show">
        <TabChip id="foryou" tab={tab} setTab={setTab} label="For you" />
        <TabChip id="saved" tab={tab} setTab={setTab} label={`Saved${pageItems.some((i) => i.saved) ? ` · ${pageItems.filter((i) => i.saved).length}` : ''}`} />
        <span className="news-tabs-sep" />
        {topicsWithStories.map((t) => (
          <TabChip key={t.id} id={t.id} tab={tab} setTab={setTab} label={t.label} dim={hideTopics.includes(t.id)} />
        ))}
        <label className="news-search">
          <Search />
          <input value={query} placeholder="Search news" aria-label="Search news" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className={`news-layout ${weather || facebook.length ? 'with-aside' : ''}`}>
        <div className="news-main">
          {feed.errors.some((e) => pageSources.some((s) => s.id === e.sourceId)) && (
            <div className="news-errors small muted">
              Couldn’t check{' '}
              {feed.errors
                .map((e) => pageSources.find((s) => s.id === e.sourceId)?.name)
                .filter(Boolean)
                .join(', ')}{' '}
              just now. Showing what was there before.
            </div>
          )}
          {pageSources.length === 0 && (
            <div className="empty-state welcome">
              <p>This page has no sources yet.</p>
              <button type="button" className="btn sm" onClick={() => setSettings(true)}>
                <Plus /> Add sources
              </button>
            </div>
          )}
          {groups && 'urgent' in groups ? (
            <>
              {look.urgent && groups.urgent!.length > 0 && (
                <section className={`news-section ${local ? 'news-urgent' : 'news-picks'}`}>
                  <h2 className="section-title">{local ? <AlertTriangle /> : <Flame />} {local ? 'Need to know' : 'Top picks'}</h2>
                  {groups.urgent!.map((i) => (
                    <NewsCard key={i.id} item={i} actions={actions} compact={local} photos={look.photos} />
                  ))}
                </section>
              )}
              {look.coming && groups.coming!.length > 0 && (
                <section className="news-section news-coming">
                  <h2 className="section-title">{local ? 'Coming up' : 'Coming up: releases and dates'}</h2>
                  <div className="news-coming-list">
                    {groups.coming!.map((i) => (
                      <ComingRow key={i.id} item={i} actions={actions} />
                    ))}
                  </div>
                </section>
              )}
              <section className="news-section">
                <h2 className="section-title">Latest</h2>
                {groups.latest!.length === 0 && pageSources.length > 0 && <div className="empty-state">No stories yet{busy ? ' – checking now…' : '.'}</div>}
                {groups.latest!.slice(0, more).map((i) => (
                  <NewsCard key={i.id} item={i} actions={actions} compact={look.compact} photos={look.photos} />
                ))}
                {groups.latest!.length > more && (
                  <button type="button" className="btn news-more" onClick={() => setMore((m) => m + 30)}>
                    Show more
                  </button>
                )}
              </section>
            </>
          ) : (
            <section className="news-section">
              {groups?.list?.length === 0 && <div className="empty-state">{tab === 'saved' ? 'Stories you save (the bookmark) show here.' : 'Nothing here right now.'}</div>}
              {groups?.list?.map((i) => (
                <NewsCard key={i.id} item={i} actions={actions} compact={look.compact} photos={look.photos} />
              ))}
            </section>
          )}
          {groups && groups.hiddenCount > 0 && tab !== 'saved' && (
            <button type="button" className="link-btn news-filtered small" onClick={() => setShowFiltered((v) => !v)}>
              {showFiltered ? 'Hide' : 'Show'} {groups.hiddenCount} {groups.hiddenCount === 1 ? 'story' : 'stories'} left out by your topics and words
            </button>
          )}
        </div>
        {(weather || facebook.length > 0) && (
          <aside className="news-aside">
            {weather && <WeatherCard weather={weather} />}
            {facebook.length > 0 && <FacebookBox pages={facebook} />}
          </aside>
        )}
      </div>

      {settings && local && <NewsSettings feed={feed} onChange={setFeed} onClose={() => setSettings(false)} />}
      {settings && page && (
        <PageSettings
          feed={feed}
          page={page}
          onChange={setFeed}
          onClose={() => setSettings(false)}
          onDeleted={(f) => {
            setFeed(f)
            setSettings(false)
            showPage(LOCAL_NEWS_PAGE)
          }}
        />
      )}
      {addPageDialog}
      {adding && (
        <AddToCalendar
          item={adding}
          onClose={() => setAdding(null)}
          onAdded={(eventId) => {
            patchItem(adding.id, { eventId })
            setAdding(null)
          }}
        />
      )}
    </div>
  )
}

/** A new page from a starting point: Games, PC parts, or empty */
function AddPageDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (f: NewsFeed) => void }) {
  const [preset, setPreset] = useState<NewsPreset>('games')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      onAdded(await api.news.addPage(preset, name.trim() || undefined))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog news-add-dialog"
        role="dialog"
        aria-label="Add a news page"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <div className="dialog-head">
          <h2>Add a news page</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="small muted">A page of its own with its own sources and topics, beside your local news.</p>
        <div className="news-presets" role="radiogroup" aria-label="Start with">
          {NEWS_PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className={`news-preset ${preset === p.id ? 'active' : ''}`} onClick={() => setPreset(p.id)}>
              {p.id === 'games' ? <Gamepad2 /> : p.id === 'pc' ? <Cpu /> : <Newspaper />}
              <b>{p.name}</b>
              <span className="small muted">{p.text}</span>
            </button>
          ))}
        </div>
        <label className="mfield">
          Name
          <input value={name} placeholder={NEWS_PRESETS.find((p) => p.id === preset)?.name} aria-label="Page name" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Getting the news…' : 'Add page'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** One of your own pages: its name, sources, topics, words and Top picks */
function PageSettings({ feed, page, onChange, onClose, onDeleted }: { feed: NewsFeed; page: NewsPage; onChange: (f: NewsFeed) => void; onClose: () => void; onDeleted: (f: NewsFeed) => void }) {
  const [draft, setDraft] = useState<NewsPage>(page)
  const [sources, setSources] = useState(feed.sources)
  const [only, setOnly] = useState(listText(page.only))
  const [muted, setMuted] = useState(listText(page.muted))
  const [boost, setBoost] = useState(listText(page.boost))
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const mine = sources.filter((s) => s.page === page.id)
  const setSource = (id: string, patch: Partial<NewsSource>): void => setSources((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const addLink = async (): Promise<void> => {
    if (!link.trim()) return
    setError('')
    try {
      const s = await api.news.detect(link)
      setSources((l) => [...l, { ...s, page: page.id }])
      setLink('')
    } catch {
      setError('Couldn’t read that link. Check it opens in your browser.')
    }
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const next = { ...draft, only: textList(only), muted: textList(muted), boost: textList(boost) }
      onChange(await api.news.configure({ pages: feed.pages.map((p) => (p.id === page.id ? next : p)), sources }))
      onClose()
    } finally {
      setSaving(false)
    }
  }
  const remove = async (): Promise<void> => onDeleted(await api.news.configure({ pages: feed.pages.filter((p) => p.id !== page.id) }))
  const toggleTopic = (t: NewsTopic): void => setDraft((d) => ({ ...d, hideTopics: d.hideTopics.includes(t) ? d.hideTopics.filter((x) => x !== t) : [...d.hideTopics, t] }))

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog news-settings" role="dialog" aria-label="Page settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Page settings</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        <label className="mfield">
          Name
          <input value={draft.name} aria-label="Page name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <div className="order-actions">
          <span className="small muted">Place among the tabs:</span>
          {[-1, 1].map((by) => {
            const at = feed.pages.findIndex((p) => p.id === page.id)
            const to = at + by
            return (
              <button
                key={by}
                type="button"
                className="btn sm"
                disabled={to < 0 || to >= feed.pages.length}
                onClick={async () => {
                  const pages = [...feed.pages]
                  pages.splice(at, 1)
                  pages.splice(to, 0, feed.pages[at])
                  onChange(await api.news.configure({ pages }))
                }}
              >
                {by < 0 ? '← Earlier' : 'Later →'}
              </button>
            )
          })}
        </div>

        <h3 className="news-settings-h">Sources</h3>
        <ul className="news-source-list editable">
          {mine.map((s) => (
            <li key={s.id}>
              <input type="checkbox" checked={s.enabled} aria-label={`Use ${s.name}`} onChange={(e) => setSource(s.id, { enabled: e.target.checked })} />
              <input className="news-source-name" value={s.name} aria-label="Source name" onChange={(e) => setSource(s.id, { name: e.target.value })} />
              <span className="muted small news-source-kind" title={s.url}>
                {KIND_LABEL[s.kind]}
              </span>
              <button
                type="button"
                className={`icon-btn sm news-star ${s.important ? 'on' : ''}`}
                aria-pressed={Boolean(s.important)}
                title={s.important ? 'Its new stories are always Top picks (click to stop)' : 'Make all its new stories Top picks'}
                aria-label={`Always a top pick: ${s.name}`}
                onClick={() => setSource(s.id, { important: !s.important })}
              >
                <Star />
              </button>
              <button type="button" className="icon-btn sm" title="Remove" aria-label={`Remove ${s.name}`} onClick={() => setSources((l) => l.filter((x) => x.id !== s.id))}>
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
        <AddLink link={link} setLink={setLink} onAdd={() => void addLink()} />
        {error && <p className="small danger-text">{error}</p>}

        <h3 className="news-settings-h">Topics in For you</h3>
        <div className="news-topic-toggles">
          {topicsFor(false).map((t) => (
            <button key={t.id} type="button" className={`chip-btn ${draft.hideTopics.includes(t.id) ? '' : 'active'}`} aria-pressed={!draft.hideTopics.includes(t.id)} onClick={() => toggleTopic(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="mfield">
          Only stories that mention one of these (commas between; blank = everything)
          <textarea rows={2} value={only} placeholder="e.g. GPU, SSD, monitor, Zelda, Steam Deck" aria-label="Only words" onChange={(e) => setOnly(e.target.value)} />
        </label>
        <label className="mfield">
          Leave out stories with these words
          <input value={muted} placeholder="e.g. mobile, crypto" aria-label="Muted words" onChange={(e) => setMuted(e.target.value)} />
        </label>
        <label className="mfield">
          Always make stories with these words Top picks
          <input value={boost} placeholder="e.g. RTX 5070, Hollow Knight" aria-label="Important words" onChange={(e) => setBoost(e.target.value)} />
        </label>
        <div className="news-add-row">
          <label className="mfield">
            Deals are Top picks when at least
            <select value={draft.minDiscount} aria-label="Top pick discount" onChange={(e) => setDraft({ ...draft, minDiscount: Number(e.target.value) })}>
              {[20, 25, 30, 40, 50, 60, 70, 80, 90].map((d) => (
                <option key={d} value={d}>
                  {d}% off
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={draft.notify} onChange={(e) => setDraft({ ...draft, notify: e.target.checked })} />
          Notify me about new Top picks
        </label>

        <div className="dialog-actions">
          {confirmDelete ? (
            <button type="button" className="btn danger news-delete-page" onClick={() => void remove()}>
              Delete “{page.name}” and its sources
            </button>
          ) : (
            <button type="button" className="btn news-delete-page" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete page
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabChip({ id, tab, setTab, label, dim }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string; dim?: boolean }) {
  return (
    <button type="button" role="tab" aria-selected={tab === id} className={`chip-btn ${tab === id ? 'active' : ''} ${dim ? 'dim' : ''}`} title={dim ? 'Left out of For you (change in Sources & topics)' : undefined} onClick={() => setTab(id)}>
      {label}
    </button>
  )
}

interface CardActions {
  open: (item: NewsItem) => void
  save: (item: NewsItem) => void
  hide: (item: NewsItem) => void
  calendar: (item: NewsItem) => void
  task: (item: NewsItem) => void
}

function NewsCard({ item, actions, compact, photos = true }: { item: NewsItem; actions: CardActions; compact?: boolean; photos?: boolean }) {
  const [imageOk, setImageOk] = useState(true)
  return (
    <article className={`news-card ${item.read ? 'read' : ''} ${item.important ? 'important' : ''} ${compact ? 'compact' : ''}`} data-topic={item.topic}>
      <div className="news-card-body">
        <div className="news-meta small">
          <span className="news-source">{item.sourceName}</span>
          <span className="muted">· {relativeTime(item.publishedAt)}</span>
          <span className={`news-topic t-${item.topic}`}>{topicLabel(item.topic)}</span>
          {item.when && <span className="news-when">{whenLabel(item.when)}</span>}
          {item.discount !== null && <span className="news-discount">−{item.discount}%</span>}
        </div>
        <h3 className="news-title">
          {item.url ? (
            <a href={item.url} onClick={(e) => (e.preventDefault(), actions.open(item))}>
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
        {item.summary && !compact && <p className="news-summary">{item.summary}</p>}
        {item.summary && compact && <p className="news-summary clamp-2">{item.summary}</p>}
        <div className="news-actions">
          <button type="button" className={`btn sm ${item.eventId ? 'on' : ''}`} onClick={() => actions.calendar(item)}>
            {item.eventId ? <CalendarCheck /> : <CalendarPlus />} {item.eventId ? 'On your calendar' : 'Add to calendar'}
          </button>
          <button type="button" className="icon-btn sm" title="Make a task" aria-label="Make a task" onClick={() => actions.task(item)}>
            <ListPlus />
          </button>
          <button type="button" className={`icon-btn sm ${item.saved ? 'on' : ''}`} title={item.saved ? 'Saved (click to unsave)' : 'Save for later'} aria-label={item.saved ? 'Unsave' : 'Save for later'} onClick={() => actions.save(item)}>
            {item.saved ? <BookmarkCheck /> : <Bookmark />}
          </button>
          <button type="button" className="icon-btn sm" title="Hide this story" aria-label="Hide this story" onClick={() => actions.hide(item)}>
            <EyeOff />
          </button>
          {item.url && (
            <button type="button" className="icon-btn sm" title="Open in your browser" aria-label="Open in your browser" onClick={() => actions.open(item)}>
              <ExternalLink />
            </button>
          )}
        </div>
      </div>
      {item.image && imageOk && photos && !compact && <img className="news-thumb" src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />}
    </article>
  )
}

function ComingRow({ item, actions }: { item: NewsItem; actions: CardActions }) {
  const d = new Date(`${item.when!.date}T12:00`)
  return (
    <div className="news-coming-row">
      <div className="news-date-badge" aria-hidden>
        <span>{d.toLocaleDateString(undefined, { month: 'short' })}</span>
        <b>{d.getDate()}</b>
      </div>
      <div className="news-coming-body">
        <a href={item.url} className="news-coming-title" onClick={(e) => (e.preventDefault(), actions.open(item))}>
          {item.title}
        </a>
        <span className="small muted">
          {whenLabel(item.when!)} · {item.sourceName}
        </span>
      </div>
      <button type="button" className={`btn sm ${item.eventId ? 'on' : ''}`} onClick={() => actions.calendar(item)} aria-label={item.eventId ? 'On your calendar' : `Add “${item.title}” to calendar`}>
        {item.eventId ? <CalendarCheck /> : <CalendarPlus />}
        {item.eventId ? 'Added' : 'Add'}
      </button>
    </div>
  )
}

function WeatherCard({ weather }: { weather: NonNullable<NewsFeed['weather']> }) {
  return (
    <section className="card news-weather" aria-label="Weather">
      <div className="news-weather-now">
        <CloudSun />
        <div>
          <div className="news-weather-temp">{weather.temp !== null ? `${weather.temp}°` : '–'}</div>
          <div className="small muted">
            {weather.now || 'Now'}
            {weather.place ? ` · ${weather.place}` : ''}
          </div>
        </div>
      </div>
      {weather.warnings.map((w) => (
        <a key={w.title} className="news-weather-warning" href={w.url || weather.url} target="_blank" rel="noreferrer">
          <AlertTriangle /> {w.title}
        </a>
      ))}
      <ul className="news-forecast">
        {weather.forecast.slice(0, 4).map((f) => (
          <li key={f.label}>
            <b>{f.label}</b> <span>{f.text}</span>
          </li>
        ))}
      </ul>
      <a className="small muted" href={weather.url} target="_blank" rel="noreferrer">
        Full forecast
      </a>
    </section>
  )
}

/** Public Facebook pages, through Facebook's own page box (it shows the page's latest posts; nothing is stored) */
function FacebookBox({ pages }: { pages: NewsSource[] }) {
  const [current, setCurrent] = useState(pages[0].id)
  const page = pages.find((p) => p.id === current) ?? pages[0]
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(180, Math.min(500, Math.round(el.clientWidth)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const src = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(page.url)}&tabs=timeline&width=${width}&height=720&small_header=true&adapt_container_width=true&hide_cover=true&show_facepile=false`
  return (
    <section className="card news-facebook" aria-label="Facebook pages" ref={box}>
      {pages.length > 1 && (
        <div className="news-fb-tabs">
          {pages.map((p) => (
            <button key={p.id} type="button" className={`chip-btn ${p.id === page.id ? 'active' : ''}`} onClick={() => setCurrent(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <iframe key={`${page.id}-${width}`} title={`${page.name} on Facebook`} src={src} width={width} height={720} style={{ border: 0 }} scrolling="yes" allow="encrypted-media" />
      <a className="small muted" href={page.url} target="_blank" rel="noreferrer">
        Open {page.name} on Facebook
      </a>
    </section>
  )
}

export function AddToCalendar({ item, onClose, onAdded }: { item: NewsItem; onClose: () => void; onAdded: (eventId: string) => void }) {
  const [title, setTitle] = useState(item.title.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, ''))
  const [date, setDate] = useState(item.when?.date ?? todayISO())
  const [start, setStart] = useState(item.when?.startTime ?? '')
  const [end, setEnd] = useState(item.when?.endTime ?? '')
  const [notes, setNotes] = useState([item.summary, item.url].filter(Boolean).join('\n\n'))
  const save = async (): Promise<void> => {
    const event = await api.calendar.create({ title: title.trim() || item.title, notes, date, startTime: start || null, endTime: start && end ? end : null })
    await api.news.mark(item.id, { eventId: event.id })
    onAdded(event.id)
    showToast('Added to your calendar', { label: 'Open', run: () => go({ view: 'calendar', date, eventId: event.id }) })
  }
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog news-add-dialog"
        role="dialog"
        aria-label="Add to calendar"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="dialog-head">
          <h2>Add to calendar</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        {!item.when && <p className="small muted">This story doesn’t say a date, so it’s set to today. Change it if you know when it is.</p>}
        <label className="mfield">
          Title
          <input value={title} aria-label="Event title" autoFocus onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="news-add-row">
          <label className="mfield">
            Date
            <input type="date" value={date} required aria-label="Event date" onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="mfield">
            Starts (optional)
            <input type="time" value={start} aria-label="Start time" onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="mfield">
            Ends
            <input type="time" value={end} disabled={!start} aria-label="End time" onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="mfield">
          Notes
          <textarea rows={4} value={notes} aria-label="Event notes" onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            <CalendarPlus /> Add to calendar
          </button>
        </div>
      </form>
    </div>
  )
}

/** Choosing a place: search, pick one */
function PlacePicker({ onPick }: { onPick: (p: NewsPlace) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<NewsPlace[] | null>(null)
  const [error, setError] = useState('')
  const search = async (): Promise<void> => {
    setError('')
    try {
      setResults(await api.news.findPlace(q))
    } catch {
      setError('Couldn’t search just now. Check the internet connection and try again.')
    }
  }
  return (
    <div className="news-place-picker">
      <form
        className="news-place-search"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input value={q} placeholder="Your town or city" aria-label="Your town or city" autoFocus onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn">
          <Search /> Find
        </button>
      </form>
      {error && <p className="small danger-text">{error}</p>}
      {results && results.length === 0 && <p className="small muted">No places found. Try the nearest town.</p>}
      {results && results.length > 0 && (
        <ul className="news-place-results">
          {results.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" onClick={() => onPick(p)}>
                <MapPin /> <b>{p.name}</b> <span className="muted">{[p.region, p.country].filter(Boolean).join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewsSetup({ onDone, onAddPage }: { onDone: (f: NewsFeed) => void; onAddPage: () => void }) {
  const [place, setPlace] = useState<NewsPlace | null>(null)
  const [suggested, setSuggested] = useState<NewsSource[]>([])
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pick = async (p: NewsPlace): Promise<void> => {
    setPlace(p)
    setSuggested(await api.news.suggest(p))
  }
  const addLink = async (): Promise<void> => {
    if (!link.trim()) return
    setError('')
    try {
      const s = await api.news.detect(link)
      setSuggested((list) => [...list, s])
      setLink('')
    } catch {
      setError('Couldn’t read that link. Check it opens in your browser.')
    }
  }
  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const current = await api.news.feed()
      onDone(await api.news.configure({ prefs: { place }, sources: [...current.sources, ...suggested] }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="news-setup">
      <Newspaper className="news-setup-icon" />
      <h1>What’s happening around you</h1>
      <p className="muted">Local news, events, closures, elections and the weather in one place. Sad news and stock markets are left out (you can change that).</p>
      {!place ? (
        <>
          <PlacePicker onPick={(p) => void pick(p)} />
          <p className="small muted news-setup-alt">
            Or skip local news and{' '}
            <button type="button" className="link-btn" onClick={onAddPage}>
              add a page for games, PC parts or anything else
            </button>
            .
          </p>
        </>
      ) : (
        <>
          <p>
            <MapPin className="inline-icon" /> <b>{place.name}</b> <span className="muted">{[place.region, place.country].filter(Boolean).join(', ')}</span>{' '}
            <button type="button" className="link-btn small" onClick={() => setPlace(null)}>
              Change
            </button>
          </p>
          <h2 className="section-title">Sources</h2>
          <ul className="news-source-list">
            {suggested.map((s) => (
              <li key={s.id}>
                <label className="check-row">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => setSuggested((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))} />
                  <span>{s.name}</span>
                  <span className="muted small">{KIND_LABEL[s.kind]}</span>
                </label>
              </li>
            ))}
          </ul>
          <AddLink link={link} setLink={setLink} onAdd={() => void addLink()} />
          {error && <p className="small danger-text">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>
              {busy ? 'Getting the news…' : 'Show me the news'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function AddLink({ link, setLink, onAdd }: { link: string; setLink: (v: string) => void; onAdd: () => void }) {
  return (
    <form
      className="news-add-link"
      onSubmit={(e) => {
        e.preventDefault()
        onAdd()
      }}
    >
      <input value={link} placeholder="Paste a link: a news site, your town’s news page, a Facebook page…" aria-label="Add a source link" onChange={(e) => setLink(e.target.value)} />
      <button type="submit" className="btn">
        <Plus /> Add
      </button>
    </form>
  )
}

const listText = (l: string[]): string => l.join(', ')
const textList = (s: string): string[] =>
  s
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)

function NewsSettings({ feed, onChange, onClose }: { feed: NewsFeed; onChange: (f: NewsFeed) => void; onClose: () => void }) {
  const others = feed.sources.filter((s) => s.page && s.page !== LOCAL_NEWS_PAGE)
  const [sources, setSources] = useState(feed.sources.filter((s) => !s.page || s.page === LOCAL_NEWS_PAGE))
  const [prefs, setPrefs] = useState<NewsPrefs>(feed.prefs)
  const [muted, setMuted] = useState(listText(feed.prefs.muted))
  const [boost, setBoost] = useState(listText(feed.prefs.boost))
  const [link, setLink] = useState('')
  const [changingPlace, setChangingPlace] = useState(false)
  const [suggested, setSuggested] = useState<NewsSource[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (prefs.place) void api.news.suggest(prefs.place).then(setSuggested)
  }, [prefs.place])
  const missing = suggested.filter((s) => !sources.some((x) => x.url === s.url))

  const addLink = async (): Promise<void> => {
    if (!link.trim()) return
    setError('')
    try {
      const s = await api.news.detect(link)
      setSources((l) => [...l, s])
      setLink('')
    } catch {
      setError('Couldn’t read that link. Check it opens in your browser.')
    }
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const all = [...sources, ...others]
      const sourcesChanged = JSON.stringify(all) !== JSON.stringify(feed.sources)
      onChange(await api.news.configure({ prefs: { ...prefs, muted: textList(muted), boost: textList(boost) }, ...(sourcesChanged ? { sources: all } : {}) }))
      onClose()
    } finally {
      setSaving(false)
    }
  }
  const toggleTopic = (t: NewsTopic): void => setPrefs((p) => ({ ...p, hideTopics: p.hideTopics.includes(t) ? p.hideTopics.filter((x) => x !== t) : [...p.hideTopics, t] }))

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog news-settings" role="dialog" aria-label="Sources and topics" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Sources & topics</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        <h3 className="news-settings-h">Your place</h3>
        {changingPlace || !prefs.place ? (
          <PlacePicker
            onPick={(p) => {
              setPrefs((x) => ({ ...x, place: p }))
              setChangingPlace(false)
            }}
          />
        ) : (
          <p>
            <MapPin className="inline-icon" /> <b>{prefs.place.name}</b> <span className="muted">{[prefs.place.region, prefs.place.country].filter(Boolean).join(', ')}</span>{' '}
            <button type="button" className="link-btn small" onClick={() => setChangingPlace(true)}>
              Change
            </button>
          </p>
        )}

        <h3 className="news-settings-h">Sources</h3>
        <ul className="news-source-list editable">
          {sources.map((s) => (
            <li key={s.id}>
              <input type="checkbox" checked={s.enabled} aria-label={`Use ${s.name}`} onChange={(e) => setSources((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))} />
              <input className="news-source-name" value={s.name} aria-label="Source name" onChange={(e) => setSources((l) => l.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
              <span className="muted small news-source-kind" title={s.url}>
                {KIND_LABEL[s.kind]}
              </span>
              {s.kind !== 'facebook' && s.kind !== 'weather' && (
                <button
                  type="button"
                  className={`icon-btn sm news-star ${s.important ? 'on' : ''}`}
                  aria-pressed={Boolean(s.important)}
                  title={s.important ? 'Its new stories always go under Need to know (click to stop)' : 'Always put its new stories under Need to know'}
                  aria-label={`Always need to know: ${s.name}`}
                  onClick={() => setSources((l) => l.map((x) => (x.id === s.id ? { ...x, important: !x.important } : x)))}
                >
                  <Star />
                </button>
              )}
              <button type="button" className="icon-btn sm" title="Remove" aria-label={`Remove ${s.name}`} onClick={() => setSources((l) => l.filter((x) => x.id !== s.id))}>
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
        <AddLink link={link} setLink={setLink} onAdd={() => void addLink()} />
        {error && <p className="small danger-text">{error}</p>}
        {missing.length > 0 && (
          <div className="news-suggested">
            <span className="small muted">Suggested for {prefs.place?.name}:</span>
            {missing.map((s) => (
              <button key={s.url} type="button" className="chip-btn" onClick={() => setSources((l) => [...l, s])}>
                <Plus /> {s.name}
              </button>
            ))}
          </div>
        )}

        <h3 className="news-settings-h">Topics in For you</h3>
        <div className="news-topic-toggles">
          {NEWS_TOPICS.map((t) => (
            <button key={t.id} type="button" className={`chip-btn ${prefs.hideTopics.includes(t.id) ? '' : 'active'}`} aria-pressed={!prefs.hideTopics.includes(t.id)} onClick={() => toggleTopic(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="mfield">
          Leave out stories with these words (commas between)
          <input value={muted} placeholder="e.g. hockey, real estate" aria-label="Muted words" onChange={(e) => setMuted(e.target.value)} />
        </label>
        <label className="mfield">
          Always put stories with these words under Need to know
          <input value={boost} placeholder="e.g. Main Street, school, market" aria-label="Important words" onChange={(e) => setBoost(e.target.value)} />
        </label>
        <div className="news-add-row">
          <label className="mfield">
            Keep stories for
            <select value={prefs.keepDays} aria-label="Keep stories for" onChange={(e) => setPrefs((p) => ({ ...p, keepDays: Number(e.target.value) }))}>
              {[7, 14, 21, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={prefs.notifyUrgent} onChange={(e) => setPrefs((p) => ({ ...p, notifyUrgent: e.target.checked }))} />
          Notify me about urgent alerts (weather warnings, closures, advisories)
        </label>
        <NewsLook />

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** How the page looks on this device */
function NewsLook() {
  const prefs = useUi((s) => s.prefs)
  const setPref = useUi((s) => s.setPref)
  const toggle = (key: string, on: boolean, defaultOn: boolean): void => setPref(key, on === defaultOn ? '' : on ? '1' : '0')
  const rows: { key: string; label: string; defaultOn: boolean }[] = [
    { key: 'newsUrgent', label: 'Show Need to know at the top', defaultOn: true },
    { key: 'newsComing', label: 'Show Coming up (stories with a date)', defaultOn: true },
    { key: 'newsPhotos', label: 'Show photos', defaultOn: true },
    { key: 'newsCompact', label: 'Compact list (headlines only)', defaultOn: false }
  ]
  return (
    <>
      <h3 className="news-settings-h">Look (this device)</h3>
      {rows.map((r) => {
        const on = prefs[r.key] ? prefs[r.key] === '1' : r.defaultOn
        return (
          <label key={r.key} className="check-row">
            <input type="checkbox" checked={on} onChange={(e) => toggle(r.key, e.target.checked, r.defaultOn)} />
            {r.label}
          </label>
        )
      })}
    </>
  )
}
