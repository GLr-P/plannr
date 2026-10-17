import { describe, expect, it } from 'vitest'
import type { DocJSON } from '../../src/shared/api'
import { copiedSlice, copyHtml, copyText } from '../../src/shared/rich-copy'

const t = (text: string, ...marks: DocJSON['marks'] & object): DocJSON => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const p = (...content: DocJSON[]): DocJSON => ({ type: 'paragraph', content })
const li = (text: string): DocJSON => ({ type: 'listItem', content: [p(t(text))] })

const doc: DocJSON[] = [
  { type: 'heading', attrs: { level: 2 }, content: [t('Plan')] },
  p(t('Plain, '), t('bold', { type: 'bold' }), t(', '), t('italic', { type: 'italic' }), t(' and '), t('red', { type: 'textStyle', attrs: { color: '#d23f3f', fontSize: '19px' } })),
  { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('marked', { type: 'highlight', attrs: { color: '#bbf7d0' } })] },
  { type: 'bulletList', content: [li('one'), li('two')] },
  { type: 'orderedList', attrs: { start: 1 }, content: [li('first')] },
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('to do'))] }] },
  p(),
  p({ type: 'formField', attrs: { label: 'Phone', kind: 'phone', value: '555-0100' } }, t(' '), { type: 'formField', attrs: { label: 'Paid', kind: 'checkbox', value: 'true' } }),
  { type: 'sheet', attrs: { cells: JSON.stringify([['Item', 'Cost'], ['Screen', '120'], ['Total', '=SUM(B2:B2)']]), formats: JSON.stringify(['auto', 'money']), header: true } },
  p(t('See '), { type: 'mention', attrs: { id: 'n1', label: 'Rosa Lima', kind: 'customer' } }, t('<now>', { type: 'link', attrs: { href: 'javascript:alert(1)' } }))
]

describe('copying to other programs', () => {
  it('writes the formatting out so Word and email keep it', () => {
    const html = copyHtml({ content: doc }).replace(/^<span data-plannr-copy="[^"]*"><\/span>/, '')
    expect(html).toContain('<h2')
    expect(html).toContain('<b>bold</b>')
    expect(html).toContain('<i>italic</i>')
    expect(html).toContain('<span style="color:#d23f3f;font-size:19px">red</span>')
    expect(html).toContain('<span style="background-color:#bbf7d0">marked</span>')
    expect(html).toContain('text-align:center')
    expect(html).toContain('<ul style="margin:0 0 6px"><li>one</li><li>two</li></ul>')
    expect(html).toContain('☑ done')
    expect(html).toContain('☐ to do')
    expect(html).not.toContain('<input')
    expect(html).toContain('<b>Phone</b>: 555-0100')
    expect(html).toContain('<th')
    expect(html).toContain('$120.00') // the formula, worked out and shown as money
    expect(html).toContain('Rosa Lima')
    expect(html).toContain('&lt;now&gt;') // text is escaped
    expect(html).not.toContain('javascript:') // unsafe links are dropped
  })

  it('gives tidy plain text: one line per paragraph, bullets, ticks and tabs', () => {
    expect(copyText({ content: doc })).toBe(
      ['Plan', 'Plain, bold, italic and red', 'marked', '• one', '• two', '1. first', '☑ done', '☐ to do', '', 'Phone: 555-0100 Paid: ☑', 'Item\tCost', 'Screen\t$120.00', 'Total\t$120.00', 'See Rosa Lima<now>'].join('\n')
    )
  })

  it('copies a few words from inside a paragraph or a list item as just the words', () => {
    const inList = { content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('two', { type: 'bold' }))] }] }], openStart: 3, openEnd: 3 }
    expect(copyText(inList)).toBe('two')
    expect(copyHtml(inList)).toMatch(/<\/span><b>two<\/b>$/)
    // Two list items keep their bullets
    const twoItems = { content: [{ type: 'bulletList', content: [li('one'), li('two')] }], openStart: 3, openEnd: 3 }
    expect(copyText(twoItems)).toBe('• one\n• two')
  })

  it('carries the exact piece for pasting back into Plannr', () => {
    const slice = { content: doc, openStart: 1, openEnd: 0 }
    expect(copiedSlice(copyHtml(slice))).toEqual(slice)
    expect(copiedSlice('<p>from Word</p>')).toBeNull()
  })
})
