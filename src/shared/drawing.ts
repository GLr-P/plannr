/**
 * Drawings (in notes and on free-form pages): strokes in a box of a fixed logical size, so they scale with the space.
 * Saved as JSON in the node's attrs; drawn as SVG on screen and on paper.
 */

export type DrawTool = 'pen' | 'marker' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse'
export interface Stroke {
  tool: Exclude<DrawTool, 'eraser'>
  color: string
  size: number
  /** x,y pairs (logical units: the drawing is DRAW_WIDTH wide) */
  points: number[]
}
export const DRAW_WIDTH = 1000

const r1 = (n: number): number => Math.round(n * 10) / 10

/** A smooth path through the points (quadratic curves between midpoints) */
export function strokePath(points: number[]): string {
  if (points.length < 4) return points.length === 2 ? `M${r1(points[0])} ${r1(points[1])}l0.1 0` : ''
  let d = `M${r1(points[0])} ${r1(points[1])}`
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2
    const my = (points[i + 1] + points[i + 3]) / 2
    d += `Q${r1(points[i])} ${r1(points[i + 1])} ${r1(mx)} ${r1(my)}`
  }
  return `${d}L${r1(points[points.length - 2])} ${r1(points[points.length - 1])}`
}

/** One stroke as SVG elements */
export function strokeSvg(s: Stroke): string {
  const [x1, y1] = [s.points[0] ?? 0, s.points[1] ?? 0]
  const [x2, y2] = [s.points[s.points.length - 2] ?? x1, s.points[s.points.length - 1] ?? y1]
  const color = /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : '#222'
  const common = `stroke="${color}" stroke-width="${r1(s.size)}" stroke-linecap="round" stroke-linejoin="round" fill="none"`
  switch (s.tool) {
    case 'line':
      return `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${common}/>`
    case 'arrow': {
      const a = Math.atan2(y2 - y1, x2 - x1)
      const h = Math.max(12, s.size * 4)
      const p = (da: number): string => `${r1(x2 - h * Math.cos(a + da))},${r1(y2 - h * Math.sin(a + da))}`
      return `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${common}/><polyline points="${p(0.45)} ${r1(x2)},${r1(y2)} ${p(-0.45)}" ${common}/>`
    }
    case 'rect':
      return `<rect x="${r1(Math.min(x1, x2))}" y="${r1(Math.min(y1, y2))}" width="${r1(Math.abs(x2 - x1))}" height="${r1(Math.abs(y2 - y1))}" rx="6" ${common}/>`
    case 'ellipse':
      return `<ellipse cx="${r1((x1 + x2) / 2)}" cy="${r1((y1 + y2) / 2)}" rx="${r1(Math.abs(x2 - x1) / 2)}" ry="${r1(Math.abs(y2 - y1) / 2)}" ${common}/>`
    case 'marker':
      return `<path d="${strokePath(s.points)}" ${common} stroke-opacity="0.35"/>`
    default:
      return `<path d="${strokePath(s.points)}" ${common}/>`
  }
}

/** A whole drawing as an SVG document (for printing and exporting) */
export function drawingSvg(strokes: Stroke[], height: number, background = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DRAW_WIDTH} ${Math.round(height)}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">${background ? `<rect width="100%" height="100%" fill="${background}"/>` : ''}${strokes.map(strokeSvg).join('')}</svg>`
}

export function parseStrokes(raw: unknown): Stroke[] {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as Stroke[]).filter((s) => s && Array.isArray(s.points)) : []
}

/** Does a point (logical units) touch this stroke? For the eraser */
export function hitsStroke(s: Stroke, x: number, y: number, radius: number): boolean {
  const pts = s.tool === 'pen' || s.tool === 'marker' ? s.points : [s.points[0], s.points[1], s.points[s.points.length - 2], s.points[s.points.length - 1]]
  if (s.tool === 'rect' || s.tool === 'ellipse') {
    const [x1, y1, x2, y2] = pts
    return x >= Math.min(x1, x2) - radius && x <= Math.max(x1, x2) + radius && y >= Math.min(y1, y2) - radius && y <= Math.max(y1, y2) + radius
  }
  for (let i = 0; i < pts.length - 2; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]
    const len = (bx - ax) ** 2 + (by - ay) ** 2
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len)) : 0
    if ((ax + t * (bx - ax) - x) ** 2 + (ay + t * (by - ay) - y) ** 2 <= (radius + s.size / 2) ** 2) return true
  }
  return pts.length === 2 && (pts[0] - x) ** 2 + (pts[1] - y) ** 2 <= radius ** 2
}
