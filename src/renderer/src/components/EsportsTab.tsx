import { useCallback, useEffect, useState } from 'react'
import { Check, Gamepad2, KeyRound, Radio, RefreshCw, Trophy } from 'lucide-react'
import { ESPORTS_GAMES, type EsportsFeed, type EsportsMatch, type EsportsSide } from '../../../shared/api'
import { api } from '../api'
import { formatDay, relativeTime, todayISO } from '../lib/format'

const has = (q: string, ...texts: string[]): boolean => !q || texts.some((t) => t.toLowerCase().includes(q.toLowerCase()))
const localDay = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const clock = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * E-sports: matches of the games you follow, from PandaScore's free plan. Each person pastes their own free token
 * (kept encrypted on this PC). Important matches (Majors, Worlds, playoffs and finals) get a badge, and can go on the calendar.
 */
export function EsportsTab({ q }: { q: string }) {
  const [feed, setFeed] = useState<EsportsFeed | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  const run = useCallback(async (job: () => Promise<EsportsFeed>) => {
    setBusy(true)
    setError('')
    try {
      setFeed(await job())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    let alive = true
    void api.esports.feed().then((f) => {
      if (!alive) return
      setFeed(f)
      if (f.configured) void run(() => api.esports.refresh())
    })
    const timer = setInterval(() => void api.esports.refresh().then((f) => alive && setFeed(f)).catch(() => undefined), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [run])

  if (!feed) return null

  if (!feed.configured)
    return (
      <div className="empty-state welcome sports-welcome">
        <Gamepad2 />
        <h2>Follow e-sports</h2>
        <p>
          Plannr gets e-sports schedules and results from PandaScore. Their basic plan is free, but everyone needs their own key:
        </p>
        <ol className="esports-steps">
          <li>
            Make a free account at{' '}
            <a href="https://www.pandascore.co/pricing" target="_blank" rel="noreferrer">
              pandascore.co
            </a>{' '}
            (no card needed).
          </li>
          <li>Copy your access token from your PandaScore dashboard.</li>
          <li>Paste it here. It stays encrypted on this PC.</li>
        </ol>
        <form
          className="news-add-link"
          onSubmit={(e) => {
            e.preventDefault()
            if (token.trim()) void run(() => api.esports.setToken(token)).then(() => setToken(''))
          }}
        >
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your PandaScore token" aria-label="PandaScore token" type="password" />
          <button type="submit" className="btn primary" disabled={busy || !token.trim()}>
            <KeyRound /> Save
          </button>
        </form>
        {error && <p className="small danger-text">{error}</p>}
      </div>
    )

  const followed = new Set(feed.games)
  const toggle = (key: string): void => {
    const next = followed.has(key) ? feed.games.filter((g) => g !== key) : [...feed.games, key]
    setFeed({ ...feed, games: next })
    void run(() => api.esports.setGames(next))
  }
  const matches = feed.matches.filter((m) => has(q, m.a.name, m.b.name, m.event, m.gameName))
  const now = Date.now()
  const live = matches.filter((m) => m.state === 'in')
  const upcoming = matches.filter((m) => m.state === 'pre' && !m.detail).slice(0, 80)
  const results = matches.filter((m) => m.state === 'post' || m.detail).reverse()
  const days = [...new Set(upcoming.map((m) => localDay(m.at)))]

  return (
    <>
      <div className="sports-following" role="group" aria-label="Games">
        <span className="small muted">Games</span>
        {ESPORTS_GAMES.map((g) => (
          <button key={g.key} type="button" className={`chip-btn ${followed.has(g.key) ? 'active' : ''}`} aria-pressed={followed.has(g.key)} onClick={() => toggle(g.key)}>
            {followed.has(g.key) && <Check />}
            {g.name}
          </button>
        ))}
        <span className="ent-push small muted">{busy ? 'Checking…' : feed.refreshedAt ? `Updated ${relativeTime(feed.refreshedAt).toLowerCase()}` : ''}</span>
        <button type="button" className="icon-btn" aria-label="Check matches now" title="Check matches now" disabled={busy || !feed.games.length} onClick={() => void run(() => api.esports.refresh(true))}>
          <RefreshCw className={busy ? 'spin' : ''} />
        </button>
        <button type="button" className="btn sm" title="Remove the saved PandaScore token (to paste a different one)" onClick={() => void run(() => api.esports.setToken(null))}>
          <KeyRound /> Change token
        </button>
      </div>
      {feed.errors.length > 0 && <p className="small muted">Couldn’t check {feed.errors.join(', ')} just now; Plannr tries again soon.</p>}
      {error && <p className="small danger-text">{error}</p>}

      {!feed.games.length ? (
        <p className="muted">Pick the games you want to follow above.</p>
      ) : (
        <div>
          {live.length > 0 && (
            <section className="ent-section">
              <h2 className="section-title">
                <Radio /> On now
              </h2>
              <div className="sports-games">{live.map((m) => <MatchRow key={m.id} m={m} now={now} />)}</div>
            </section>
          )}
          <section className="ent-section">
            <h2 className="section-title">
              <Trophy /> Coming up
            </h2>
            {days.length === 0 && <p className="muted small">{busy ? 'Getting matches…' : 'No matches in the next two weeks.'}</p>}
            {days.map((d) => (
              <div key={d} className="sports-day">
                <h3 className="small muted">{d === todayISO() ? `Today · ${formatDay(d)}` : formatDay(d)}</h3>
                <div className="sports-games">
                  {upcoming.filter((m) => localDay(m.at) === d).map((m) => (
                    <MatchRow key={m.id} m={m} now={now} />
                  ))}
                </div>
              </div>
            ))}
          </section>
          {results.length > 0 && (
            <section className="ent-section">
              <h2 className="section-title">
                <Check /> Results
              </h2>
              <div className="sports-games">{results.slice(0, 30).map((m) => <MatchRow key={m.id} m={m} now={now} />)}</div>
            </section>
          )}
          <p className="small muted">E-sports data from PandaScore.</p>
        </div>
      )}
    </>
  )
}

function Side({ s, m }: { s: EsportsSide; m: EsportsMatch }) {
  const lost = m.state === 'post' && !s.winner && (m.a.winner || m.b.winner)
  return (
    <span className={`sports-side ${lost ? 'lost' : ''}`}>
      {s.logo ? <img src={s.logo} alt="" referrerPolicy="no-referrer" /> : <span className="sports-logo-empty" />}
      <span className="sports-name" title={s.name}>
        {s.name}
      </span>
      {m.state !== 'pre' && <b className="sports-score">{s.score}</b>}
    </span>
  )
}

function MatchRow({ m, now }: { m: EsportsMatch; now: number }) {
  return (
    <a className={`sports-game ${m.big ? 'mine' : ''} ${m.state}`} href={m.url || undefined} target="_blank" rel="noreferrer" title={m.url ? `${m.a.name} vs ${m.b.name}: open the stream` : `${m.a.name} vs ${m.b.name}`}>
      <span className="sports-when">
        {m.state === 'in' ? (
          <span className="ent-live-badge inline">LIVE</span>
        ) : m.state === 'post' ? (
          <>
            <b className="small">Final</b>
            <span className="small muted">{localDay(m.at) === localDay(now) ? 'Today' : formatDay(localDay(m.at))}</span>
          </>
        ) : m.detail ? (
          <b className="small">{m.detail}</b>
        ) : (
          <b>{clock(m.at)}</b>
        )}
      </span>
      <span className="sports-teams">
        <Side s={m.a} m={m} />
        <Side s={m.b} m={m} />
      </span>
      <span className="sports-meta small muted">
        <span>
          {m.big && <Trophy className="sports-star" aria-label="Important match" />}
          {m.gameName}
          {m.bestOf > 1 ? ` · Bo${m.bestOf}` : ''}
        </span>
        <span title={m.event}>{m.big || m.event}</span>
      </span>
    </a>
  )
}
