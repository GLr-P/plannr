import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Newspaper, Radio, RefreshCw, Settings2, Star, Trophy } from 'lucide-react'
import { SPORTS_LEAGUES, type SportsFeed, type SportsGame, type SportsPrefs, type SportsSide, type SportsTeam } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { formatDay, relativeTime, todayISO } from '../lib/format'

const has = (q: string, ...texts: string[]): boolean => !q || texts.some((t) => t.toLowerCase().includes(q.toLowerCase()))
const localDay = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const clock = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const SPORTS = [...new Set(SPORTS_LEAGUES.map((l) => l.sport))]

/**
 * Sports: games, scores and headlines for what you follow. Each league is off, "my teams only" (just your
 * favourite teams' games and stories) or "every game"; favourites are starred everywhere.
 */
export function SportsTab({ q }: { q: string }) {
  const [feed, setFeed] = useState<SportsFeed | null>(null)
  const [busy, setBusy] = useState(false)
  const [setup, setSetup] = useState(false)
  const filter = (useUi((s) => s.prefs.sportsFilter) as string | undefined) || 'all'
  const setPref = useUi((s) => s.setPref)

  const refresh = useCallback(async (force?: boolean) => {
    setBusy(true)
    try {
      setFeed(await api.sports.refresh(force))
    } catch {
      /* the feed keeps its last download */
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    let alive = true
    void api.sports.feed().then((f) => {
      if (!alive) return
      setFeed(f)
      // Nothing followed yet: open the list of leagues (it stays open while you pick)
      if (!f.prefs.leagues.length && !f.prefs.teams.length) setSetup(true)
      void refresh()
    })
    // Scores update while you watch (the service downloads only when due: every 2 minutes during a game)
    const timer = setInterval(() => void api.sports.refresh().then((f) => alive && setFeed(f)).catch(() => undefined), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refresh])

  if (!feed) return null
  const { prefs } = feed
  const following = prefs.leagues.length > 0 || prefs.teams.length > 0
  const leagues = SPORTS_LEAGUES.filter((l) => prefs.leagues.includes(l.key) || prefs.teams.some((t) => t.league === l.key))
  const show = (league: string, mine: boolean): boolean => filter === 'all' || (filter === 'mine' ? mine : league === filter)
  const games = feed.games.filter((g) => show(g.league, g.mine) && has(q, g.home.name, g.away.name, g.leagueName))
  const news = feed.news.filter((n) => show(n.league, n.mine) && has(q, n.title, n.summary, n.leagueName))
  const now = Date.now()
  const live = games.filter((g) => g.state === 'in')
  const upcoming = games.filter((g) => g.state === 'pre' && !g.detail).slice(0, filter === 'mine' ? 40 : 80)
  const results = games.filter((g) => g.state === 'post' || (g.state === 'pre' && g.detail)).reverse()
  const days = [...new Set(upcoming.map((g) => localDay(g.at)))]
  const save = async (next: SportsPrefs): Promise<void> => {
    setFeed({ ...feed, prefs: next })
    setBusy(true)
    try {
      setFeed(await api.sports.setPrefs(next))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="news-tabs sports-bar">
        {following && leagues.length + (prefs.teams.length ? 1 : 0) > 1 && (
          <>
            <button type="button" className={`chip-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setPref('sportsFilter', '')}>
              All
            </button>
            {prefs.teams.length > 0 && (
              <button type="button" className={`chip-btn ${filter === 'mine' ? 'active' : ''}`} onClick={() => setPref('sportsFilter', 'mine')}>
                <Star /> My teams
              </button>
            )}
            {leagues.map((l) => (
              <button key={l.key} type="button" className={`chip-btn ${filter === l.key ? 'active' : ''}`} onClick={() => setPref('sportsFilter', l.key)}>
                {l.name}
              </button>
            ))}
          </>
        )}
        <span className="ent-push small muted">{busy ? 'Checking…' : feed.refreshedAt ? `Updated ${relativeTime(feed.refreshedAt).toLowerCase()}` : ''}</span>
        {following && (
          <button type="button" className="icon-btn" aria-label="Check scores now" title="Check scores now" disabled={busy} onClick={() => void refresh(true)}>
            <RefreshCw className={busy ? 'spin' : ''} />
          </button>
        )}
        <button type="button" className={`btn sm ${setup ? 'active-btn' : ''}`} aria-expanded={setup} onClick={() => setSetup((s) => !s)}>
          <Settings2 /> Leagues & teams
        </button>
      </div>

      {setup && <SportsSetup prefs={prefs} onChange={(p) => void save(p)} />}
      {feed.errors.length > 0 && <p className="small muted">Couldn’t check {feed.errors.join(', ')} just now; Plannr tries again soon.</p>}

      {following && (
        <div className="sports-columns">
          <div>
            {live.length > 0 && (
              <section className="ent-section">
                <h2 className="section-title">
                  <Radio /> On now
                </h2>
                <div className="sports-games">{live.map((g) => <GameRow key={g.id} g={g} now={now} />)}</div>
              </section>
            )}
            <section className="ent-section">
              <h2 className="section-title">
                <Trophy /> Coming up
              </h2>
              {days.length === 0 && <p className="muted small">{busy ? 'Getting games…' : 'No games in the next few weeks.'}</p>}
              {days.map((d) => (
                <div key={d} className="sports-day">
                  <h3 className="small muted">{d === todayISO() ? 'Today' : formatDay(d)}</h3>
                  <div className="sports-games">
                    {upcoming.filter((g) => localDay(g.at) === d).map((g) => (
                      <GameRow key={g.id} g={g} now={now} />
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
                <div className="sports-games">{results.slice(0, 40).map((g) => <GameRow key={g.id} g={g} now={now} />)}</div>
              </section>
            )}
          </div>
          <section className="ent-section">
            <h2 className="section-title">
              <Newspaper /> Headlines
            </h2>
            {news.length === 0 && <p className="muted small">{busy ? 'Getting headlines…' : 'No headlines right now.'}</p>}
            <div className="ent-feed-list">
              {news.slice(0, 40).map((n) => (
                <div key={n.id} className="ent-post">
                  <a className="ent-post-open sports-news" href={n.url} target="_blank" rel="noreferrer">
                    {n.image && <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    <span className="ent-post-text">
                      <span className="small muted">
                        {n.mine && <Star className="sports-star" aria-label="Your team" />}
                        {n.leagueName} · {relativeTime(n.publishedAt)}
                      </span>
                      <b className="ent-clamp">{n.title}</b>
                      {n.summary && <span className="small muted ent-clamp">{n.summary}</span>}
                    </span>
                  </a>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function Side({ s, g }: { s: SportsSide; g: SportsGame }) {
  const lost = g.state === 'post' && !s.winner && (g.home.winner || g.away.winner)
  return (
    <span className={`sports-side ${lost ? 'lost' : ''}`}>
      {s.logo ? <img src={s.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="sports-logo-empty" />}
      <span className="sports-name" title={s.name}>
        {s.short || s.name}
      </span>
      {g.state !== 'pre' && <b className="sports-score">{s.score}</b>}
    </span>
  )
}

function GameRow({ g, now }: { g: SportsGame; now: number }) {
  const when = g.state === 'in' ? g.detail || 'On now' : g.state === 'post' ? `${g.detail || 'Final'} · ${localDay(g.at) === localDay(now) ? 'today' : formatDay(localDay(g.at))}` : g.detail || clock(g.at)
  return (
    <a className={`sports-game ${g.mine ? 'mine' : ''} ${g.state}`} href={g.url || undefined} target="_blank" rel="noreferrer" title={`${g.away.name} at ${g.home.name}`}>
      <span className="sports-when small">
        {g.state === 'in' && <span className="ent-live-badge inline">LIVE</span>} {when}
      </span>
      <span className="sports-teams">
        <Side s={g.away} g={g} />
        <Side s={g.home} g={g} />
      </span>
      <span className="sports-meta small muted">
        {g.mine && <Star className="sports-star" aria-label="Your team" />}
        {g.leagueName}
        {g.tv && g.state !== 'post' ? ` · ${g.tv}` : ''}
      </span>
    </a>
  )
}

/** Each league: off, my teams only, or every game; and the favourite teams */
function SportsSetup({ prefs, onChange }: { prefs: SportsPrefs; onChange: (p: SportsPrefs) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [teams, setTeams] = useState<Record<string, SportsTeam[] | 'error'>>({})
  const [find, setFind] = useState('')
  const toggle = (key: string): void => {
    setFind('')
    setOpen((o) => (o === key ? null : key))
    if (!teams[key])
      void api.sports
        .teams(key)
        .then((list) => setTeams((t) => ({ ...t, [key]: list })))
        .catch(() => setTeams((t) => ({ ...t, [key]: 'error' })))
  }
  const isFav = (t: SportsTeam): boolean => prefs.teams.some((x) => x.league === t.league && x.id === t.id)
  const setLeague = (key: string, all: boolean): void => onChange({ ...prefs, leagues: all ? [...prefs.leagues, key] : prefs.leagues.filter((l) => l !== key) })
  const setFav = (t: SportsTeam, on: boolean): void => onChange({ ...prefs, teams: on ? [...prefs.teams, t] : prefs.teams.filter((x) => !(x.league === t.league && x.id === t.id)) })

  return (
    <section className="card sports-setup">
      <p className="small muted">
        Pick <b>Every game</b> for the leagues you watch, and star your favourite teams in any league: their games and news show even when the rest of that league doesn’t.
      </p>
      {SPORTS.map((sport) => (
        <div key={sport} className="sports-setup-sport">
          <h3 className="small muted">{sport}</h3>
          {SPORTS_LEAGUES.filter((l) => l.sport === sport).map((l) => {
            const favs = prefs.teams.filter((t) => t.league === l.key)
            const all = prefs.leagues.includes(l.key)
            const list = teams[l.key]
            return (
              <div key={l.key} className="sports-league">
                <div className="sports-league-row">
                  <button type="button" className="sports-league-name" aria-expanded={open === l.key} onClick={() => toggle(l.key)}>
                    {open === l.key ? <ChevronDown /> : <ChevronRight />}
                    <b>{l.name}</b>
                    <span className="small muted">{favs.length ? favs.map((t) => t.short || t.name).join(', ') : 'Pick teams'}</span>
                  </button>
                  <div className="segmented" role="radiogroup" aria-label={`${l.name} games`}>
                    <button type="button" role="radio" aria-checked={!all} className={!all ? 'active' : ''} onClick={() => all && setLeague(l.key, false)}>
                      {favs.length ? 'My teams' : 'Off'}
                    </button>
                    <button type="button" role="radio" aria-checked={all} className={all ? 'active' : ''} onClick={() => !all && setLeague(l.key, true)}>
                      Every game
                    </button>
                  </div>
                </div>
                {open === l.key && (
                  <div className="sports-team-pick">
                    {list === 'error' ? (
                      <p className="small danger-text">Couldn’t get the teams; check the internet connection.</p>
                    ) : !list ? (
                      <p className="small muted">Getting teams…</p>
                    ) : (
                      <>
                        {list.length > 40 && <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a team" aria-label={`Find a ${l.name} team`} />}
                        <div className="sports-team-grid">
                          {list
                            .filter((t) => isFav(t) || has(find, t.name, t.abbr))
                            .slice(0, 80)
                            .map((t) => {
                              const on = isFav(t)
                              return (
                                <button key={t.id} type="button" className={`sports-team ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setFav(t, !on)}>
                                  {t.logo ? <img src={t.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="sports-logo-empty" />}
                                  <span>{t.name}</span>
                                  {on && <Star className="sports-star" />}
                                </button>
                              )
                            })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}
