import type { FetchText } from './news'

/**
 * Reddit lets a reader without an account ask about once a minute (per internet connection) and answers
 * "429 Too Many Requests" to anything sooner. Every Reddit download (subreddits, News pages, Discover) goes
 * through one queue that spaces them a minute apart and tries once more after a refusal.
 */

export const REDDIT_GAP_MS = 61_000
export const isReddit = (url: string): boolean => /^https:\/\/(?:www\.|old\.)?reddit\.com\//i.test(url)

export function createRedditGate(wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = () => Date.now()) {
  let last = -Infinity
  let queue: Promise<unknown> = Promise.resolve()
  return (fetchText: FetchText): FetchText =>
    (url, post) => {
      if (!isReddit(url)) return fetchText(url, post)
      const run = queue.then(async () => {
        for (let attempt = 0; ; attempt++) {
          const gap = last + REDDIT_GAP_MS - now()
          if (gap > 0) await wait(gap)
          last = now()
          try {
            return await fetchText(url, post)
          } catch (e) {
            if (attempt === 0 && /429/.test(String(e))) continue
            throw e
          }
        }
      })
      queue = run.catch(() => undefined)
      return run
    }
}

/** The one queue for this app (one internet connection) */
export const pacedForReddit = createRedditGate()
