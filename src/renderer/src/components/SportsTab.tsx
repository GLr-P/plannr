import { useCallback, useEffect, useState } from 'react'
import { Check, MapPin, Newspaper, Pencil, Radio, RefreshCw, Search, Star, Trophy, Tv, X } from 'lucide-react'
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
const leagueName = (key: string): string => SPORTS_LEAGUES.find((l) => l.key === key)?.name ?? key
const teamKey = (t: { league: string; id: string }): string => `team:${t.league}:${t.id}`

/**
 * Sports: games, scores and headlines for what you follow. You star teams in any league (their games and news show)
 * and can turn on every game of a league. What you follow is a row of chips that also filters the page;
 * choosing happens in a dialog.
 */
export function SportsTab({ q }: { q: string }) {
  const [feed, setFeed] = useState<SportsFeed | null>(null)
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const pref = (useUi((s) => s.prefs.sportsFilter) as string | undefined) ?? ''
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
  const save = async (next: SportsPrefs): Promise<void> => {
    setFeed({ ...feed, prefs: next })
    setBusy(true)
    try {
      setFeed(await api.sports.setPrefs(next))
    } finally {
      setBusy(false)
    }
  }
  const dialog = choosing && <ChooseDialog prefs={prefs} onChange={(p) => void save(p)} onClose={() => setChoosing(false)} />

  if (!following)
    return (
      <>
        <div className="empty-state welcome sports-welcome">
          <Trophy />
          <h2>Follow your teams</h2>
          <p>Star the teams you care about to see their upcoming games, live scores and news here. Want a whole league? Turn on every game for it.</p>
          <button type="button" className="btn primary" onClick={() => setChoosing(true)}>
            <Star /> Choose teams
          </button>
        </div>
        {dialog}
      </>
    )

  // The filter: everything, one team, or one whole league (an old or removed choice falls back to everything)
  const chips = [...prefs.teams.map(teamKey), ...prefs.leagues.map((l) => `league:${l}`)]
  const filter = chips.includes(pref) ? pref : ''
  const [, fLeague, fTeam] = filter.split(':')
  const showGame = (g: SportsGame): boolean => !filter || (filter.startsWith('team:') ? g.league === fLeague && (g.home.id === fTeam || g.away.id === fTeam) : g.league === fLeague)
  const games = feed.games.filter((g) => showGame(g) && has(q, g.home.name, g.away.name, g.leagueName))
  const news = feed.news.filter((n) => (!filter || (filter.startsWith('team:') ? n.league === fLeague && n.teamIds.includes(fTeam) : n.league === fLeague)) && has(q, n.title, n.summary, n.leagueName))
  const now = Date.now()
  const live = games.filter((g) => g.state === 'in')
  const upcoming = games.filter((g) => g.state === 'pre' && !g.detail).slice(0, 60)
  const results = games.filter((g) => g.state === 'post' || (g.state === 'pre' && g.detail)).reverse()
  const days = [...new Set(upcoming.map((g) => localDay(g.at)))]

  return (
    <>
      <div className="sports-following" role="group" aria-label="Following">
        <span className="small muted">Following</span>
        <button type="button" className={`chip-btn ${!filter ? 'active' : ''}`} onClick={() => setPref('sportsFilter', '')}>
          Everything
        </button>
        {prefs.teams.map((t) => (
          <button key={teamKey(t)} type="button" className={`chip-btn sports-chip ${filter === teamKey(t) ? 'active' : ''}`} title={`${t.name} (${leagueName(t.league)})`} onClick={() => setPref('sportsFilter', teamKey(t))}>
            {t.logo ? <img src={t.logo} alt="" referrerPolicy="no-referrer" /> : <Star />}
            {t.short || t.name}
          </button>
        ))}
        {prefs.leagues.map((l) => (
          <button key={l} type="button" className={`chip-btn ${filter === `league:${l}` ? 'active' : ''}`} onClick={() => setPref('sportsFilter', `league:${l}`)}>
            All {leagueName(l)}
          </button>
        ))}
        <span className="ent-push small muted">{busy ? 'Checking…' : feed.refreshedAt ? `Updated ${relativeTime(feed.refreshedAt).toLowerCase()}` : ''}</span>
        <button type="button" className="icon-btn" aria-label="Check scores now" title="Check scores now" disabled={busy} onClick={() => void refresh(true)}>
          <RefreshCw className={busy ? 'spin' : ''} />
        </button>
        <button type="button" className="btn sm" onClick={() => setChoosing(true)}>
          <Pencil /> Edit teams
        </button>
      </div>
      {feed.errors.length > 0 && <p className="small muted">Couldn’t check {feed.errors.join(', ')} just now; Plannr tries again soon.</p>}

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
            {days.length === 0 && <p className="muted small">{busy ? 'Getting games…' : 'No games in the next three weeks (off-season?).'}</p>}
            {days.map((d) => (
              <div key={d} className="sports-day">
                <h3 className="small muted">{d === todayISO() ? `Today · ${formatDay(d)}` : formatDay(d)}</h3>
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
              <div className="sports-games">{results.slice(0, 30).map((g) => <GameRow key={g.id} g={g} now={now} />)}</div>
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
      {dialog}
    </>
  )
}

function Side({ s, g, home }: { s: SportsSide; g: SportsGame; home: boolean }) {
  const lost = g.state === 'post' && !s.winner && (g.home.winner || g.away.winner)
  return (
    <span className={`sports-side ${lost ? 'lost' : ''}`}>
      {s.logo ? <img src={s.logo} alt="" referrerPolicy="no-referrer" /> : <span className="sports-logo-empty" />}
      <span className="sports-name" title={s.name}>
        {s.name}
      </span>
      {s.record && <span className="sports-record small muted">{s.record}</span>}
      {home && <span className="sports-home small muted">home</span>}
      {g.state !== 'pre' && <b className="sports-score">{s.score}</b>}
    </span>
  )
}

function GameRow({ g, now }: { g: SportsGame; now: number }) {
  return (
    <a className={`sports-game ${g.mine ? 'mine' : ''} ${g.state}`} href={g.url || undefined} target="_blank" rel="noreferrer" title={`${g.away.name} at ${g.home.name}: open the game on ESPN`}>
      <span className="sports-when">
        {g.state === 'in' ? (
          <>
            <span className="ent-live-badge inline">LIVE</span>
            <span className="small">{g.detail}</span>
          </>
        ) : g.state === 'post' ? (
          <>
            <b className="small">{g.detail || 'Final'}</b>
            <span className="small muted">{localDay(g.at) === localDay(now) ? 'Today' : formatDay(localDay(g.at))}</span>
          </>
        ) : g.detail ? (
          <b className="small">{g.detail}</b>
        ) : (
          <b>{clock(g.at)}</b>
        )}
      </span>
      <span className="sports-teams">
        <Side s={g.away} g={g} home={false} />
        <Side s={g.home} g={g} home />
      </span>
      <span className="sports-meta small muted">
        <span>
          {g.mine && <Star className="sports-star" aria-label="Your team" />}
          {g.leagueName}
        </span>
        {g.venue && (
          <span title={g.venue}>
            <MapPin /> {g.venue}
          </span>
        )}
        {g.tv && g.state !== 'post' && (
          <span title={g.tv}>
            <Tv /> {g.tv}
          </span>
        )}
      </span>
    </a>
  )
}

/** Choose what to follow: leagues on the left; on the right, every game of that league on or off, and its teams to star */
function ChooseDialog({ prefs, onChange, onClose }: { prefs: SportsPrefs; onChange: (p: SportsPrefs) => void; onClose: () => void }) {
  const [league, setLeague] = useState(() => prefs.teams[0]?.league ?? prefs.leagues[0] ?? SPORTS_LEAGUES[0].key)
  const [teams, setTeams] = useState<Record<string, SportsTeam[] | 'error'>>({})
  const [find, setFind] = useState('')
  useEffect(() => {
    if (teams[league]) return
    void api.sports
      .teams(league)
      .then((list) => setTeams((t) => ({ ...t, [league]: list })))
      .catch(() => setTeams((t) => ({ ...t, [league]: 'error' })))
  }, [league, teams])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const name = leagueName(league)
  const all = prefs.leagues.includes(league)
  const list = teams[league]
  const isFav = (t: SportsTeam): boolean => prefs.teams.some((x) => x.league === t.league && x.id === t.id)
  const setAll = (on: boolean): void => onChange({ ...prefs, leagues: on ? [...prefs.leagues, league] : prefs.leagues.filter((l) => l !== league) })
  const setFav = (t: SportsTeam, on: boolean): void => onChange({ ...prefs, teams: on ? [...prefs.teams, t] : prefs.teams.filter((x) => !(x.league === t.league && x.id === t.id)) })
  const summary = [...prefs.teams.map((t) => t.short || t.name), ...prefs.leagues.map((l) => `every ${leagueName(l)} game`)]

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog sports-dialog" role="dialog" aria-label="Choose your teams" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sports-dialog-head">
          <div>
            <h2>Choose your teams</h2>
            <p className="small muted">Star teams to see their games, scores and news, even in sports you don’t otherwise follow. Turn on a whole league to see every game in it.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="sports-dialog-body">
          <nav className="sports-league-list" aria-label="Leagues">
            {SPORTS.map((sport) => (
              <div key={sport}>
                <h3 className="small muted">{sport}</h3>
                {SPORTS_LEAGUES.filter((l) => l.sport === sport).map((l) => {
                  const n = prefs.teams.filter((t) => t.league === l.key).length
                  const on = prefs.leagues.includes(l.key)
                  return (
                    <button
                      key={l.key}
                      type="button"
                      className={`sports-league-item ${league === l.key ? 'active' : ''}`}
                      aria-current={league === l.key}
                      onClick={() => {
                        setLeague(l.key)
                        setFind('')
                      }}
                    >
                      <span>{l.name}</span>
                      <span className="small muted">{on ? 'Every game' : n ? `${n} team${n > 1 ? 's' : ''}` : ''}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="sports-league-panel">
            <h3>{name}</h3>
            <label className="sports-switch">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              <span>
                <b>Every {name} game</b>
                <span className="small muted">{all ? `All ${name} games and the top ${name} headlines show.` : `Off: only your starred ${name} teams show.`}</span>
              </span>
            </label>
            <div className="sports-team-head">
              <b>Teams</b>
              <span className="small muted">Click a team to star it</span>
              {Array.isArray(list) && list.length > 12 && (
                <label className="news-search">
                  <Search />
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a team" aria-label={`Find a ${name} team`} />
                </label>
              )}
            </div>
            {list === 'error' ? (
              <p className="small danger-text">Couldn’t get the teams; check the internet connection.</p>
            ) : !list ? (
              <p className="small muted">Getting teams…</p>
            ) : (
              <div className="sports-team-grid">
                {list
                  .filter((t) => isFav(t) || has(find, t.name, t.abbr))
                  .slice(0, 120)
                  .map((t) => {
                    const on = isFav(t)
                    return (
                      <button key={t.id} type="button" className={`sports-team ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setFav(t, !on)}>
                        {t.logo ? <img src={t.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="sports-logo-empty" />}
                        <span>{t.name}</span>
                        <Star className={`sports-star ${on ? '' : 'off'}`} />
                      </button>
                    )
                  })}
              </div>
            )}
          </div>
        </div>
        <div className="sports-dialog-foot">
          <span className="small muted">{summary.length ? `Following: ${summary.join(', ')}` : 'Nothing followed yet'}</span>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
