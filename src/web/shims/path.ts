/* node:path for the phone web app: forward slashes; backslashes (paths made on Windows) count as separators too. */

export const sep = '/'

function normalize(parts: string[]): string {
  const out: string[] = []
  for (const part of parts.join('/').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

export function join(...parts: string[]): string {
  const absolute = parts[0]?.startsWith('/') ?? false
  return (absolute ? '/' : '') + normalize(parts)
}

export function basename(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? ''
}

export function dirname(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i <= 0 ? (s.startsWith('/') ? '/' : '.') : s.slice(0, i)
}

export function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i)
}

export default { sep, join, basename, dirname, extname }
