import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../../src/main/db'
import { calculate, cellName, colName, evaluateSheet, formatCell } from '../../src/shared/sheet'
import { drawingSvg, hitsStroke, strokeSvg, type Stroke } from '../../src/shared/drawing'
import { createNote, duplicateNote, getNote, listVersions, restoreVersion, updateNote } from '../../src/main/services/notes'
import { extractText } from '../../src/main/services/doc'
import { docToMarkdown } from '../../src/main/services/portability'
import type { DocJSON } from '../../src/shared/api'

const money = (c: number): string => `$${(c / 100).toFixed(2)}`

describe('spreadsheets', () => {
  it('works out formulas, ranges and functions', () => {
    const v = evaluateSheet([
      ['Item', 'Qty', 'Price', 'Total'],
      ['Screen', '2', '$129.50', '=B2*C2'],
      ['Battery', '3', '45', '=B3*C3'],
      ['Sum', '=SUM(B2:B3)', '=AVERAGE(C2:C3)', '=SUM(D2:D3)'],
      ['', '=IF(D4>300, "big", "small")', '=ROUND(C4, 1)', '=MAX(D2:D3)-MIN(D2:D3)']
    ])
    expect(v[1][3]).toBe(259)
    expect(v[2][3]).toBe(135)
    expect(v[3][1]).toBe(5)
    expect(v[3][2]).toBe(87.25)
    expect(v[3][3]).toBe(394)
    expect(v[4][1]).toBe('big')
    expect(v[4][2]).toBe(87.3)
    expect(v[4][3]).toBe(124)
  })
  it('shows errors instead of crashing', () => {
    const v = evaluateSheet([['=1/0', '=A1+1', '=B1', '=NOPE(1)', '=A5+(', '=C1']])
    expect(v[0][0]).toBe('#DIV/0')
    expect(String(v[0][3])).toBe('#NAME')
    expect(String(v[0][4]).startsWith('#')).toBe(true)
    const loop = evaluateSheet([['=B1', '=A1']])
    expect(String(loop[0][0])).toMatch(/^#/)
  })
  it('formats columns and names cells', () => {
    expect(formatCell(1234.5, 'money', money)).toBe('$1234.50')
    expect(formatCell(0.125, 'percent', money)).toBe('12.5%')
    expect(formatCell('hi', 'number', money)).toBe('hi')
    expect(colName(0)).toBe('A')
    expect(colName(26)).toBe('AA')
    expect(cellName(2, 1)).toBe('B3')
    expect(calculate('1299 * 0.12 + 45')).toBeCloseTo(200.88)
    expect(calculate('200 + 10%')).toBe(200.1)
    expect(calculate('hello')).toBeNull()
  })
})

describe('drawings', () => {
  it('draws strokes as SVG and erases what the eraser touches', () => {
    const pen: Stroke = { tool: 'pen', color: '#d23f3f', size: 4, points: [10, 10, 50, 50, 90, 10] }
    const box: Stroke = { tool: 'rect', color: '#2f6ae0', size: 3, points: [100, 100, 200, 160] }
    expect(strokeSvg(pen)).toContain('<path d="M10 10Q50 50')
    expect(strokeSvg(box)).toContain('<rect x="100" y="100" width="100" height="60"')
    expect(strokeSvg({ ...box, tool: 'arrow' })).toContain('<polyline')
    expect(drawingSvg([pen, box], 400)).toContain('viewBox="0 0 1000 400"')
    expect(hitsStroke(pen, 30, 30, 5)).toBe(true)
    expect(hitsStroke(pen, 300, 300, 5)).toBe(false)
    expect(hitsStroke(box, 150, 130, 5)).toBe(true)
  })
})

describe('notes: versions, copies, text', () => {
  it('keeps earlier versions and brings one back; duplicates a note', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const n = createNote(db, { title: 'Plan' })
    const para = (t: string): DocJSON => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
    updateNote(db, n.id, { content: para('first draft') })
    updateNote(db, n.id, { content: para('second draft') }) // within 10 minutes: no new version
    expect(listVersions(db, n.id)).toHaveLength(1) // the empty note before the first edit
    // Pretend the last version is old, then edit again
    db.prepare('UPDATE note_versions SET created_at = created_at - 3600000').run()
    updateNote(db, n.id, { content: para('third draft') })
    const versions = listVersions(db, n.id)
    expect(versions).toHaveLength(2)
    expect(extractText(versions[0].content)).toBe('second draft')
    restoreVersion(db, versions[0].id)
    expect(extractText(getNote(db, n.id)!.content)).toBe('second draft')
    expect(listVersions(db, n.id).some((v) => extractText(v.content) === 'third draft')).toBe(true) // and that can come back too
    const copy = duplicateNote(db, n.id)
    expect(copy.title).toBe('Plan (copy)')
    expect(extractText(copy.content)).toBe('second draft')
  })

  it('spreadsheets and calculations are searchable and export to Markdown', () => {
    const doc: DocJSON = {
      type: 'doc',
      content: [
        { type: 'sheet', attrs: { cells: JSON.stringify([['Item', 'Cost'], ['Paint', '40'], ['Total', '=SUM(B2:B2)']]) } },
        { type: 'mathLine', attrs: { expr: '40 * 1.12' } }
      ]
    }
    const text = extractText(doc)
    expect(text).toContain('Paint 40')
    expect(text).toContain('Total 40')
    expect(text).toContain('40 * 1.12 = 44.8')
    const md = docToMarkdown(doc)
    expect(md).toContain('| Item | Cost |')
    expect(md).toContain('| Total | 40 |')
    expect(md).toContain('`40 * 1.12` = 44.8')
  })
})
