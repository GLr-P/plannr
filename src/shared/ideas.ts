/** One suggestion from the assistant: "Title (Year) | why you might like it" */
export interface Idea {
  title: string
  year: number | null
  reason: string
}

/** Reads the assistant's list of suggestions (one per line, "Title (Year) | reason"; bullets and numbers allowed) */
export function parseIdeas(reply: string): Idea[] {
  return reply
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [left, ...rest] = l.split('|')
      const clean = left
        .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s*/, '')
        .replace(/\*+/g, '')
        .trim()
      const y = /\((\d{4})\)\s*$/.exec(clean)
      return { title: clean.replace(/\s*\(\d{4}\)\s*$/, '').replace(/^["“]|["”]$/g, '').trim(), year: y ? Number(y[1]) : null, reason: rest.join('|').trim() }
    })
    .filter((i) => i.title && !/^title$/i.test(i.title))
    .slice(0, 12)
}
