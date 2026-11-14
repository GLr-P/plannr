import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Writing a page the way people do, keyboard first. Each test is something that went wrong in a hands-on run.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-typing-'))
let app: ElectronApplication
let page: Page

type J = { type: string; text?: string; attrs?: Record<string, unknown>; content?: J[] }
const short = (n: J): string => (n.text !== undefined ? JSON.stringify(n.text) : n.type + (n.content ? `(${n.content.map(short).join(' ')})` : ''))
/** The page's blocks, compactly: paragraph("text"), heading("…"), codeBlock("…")…, without the empty line(s) the editor keeps at the end */
const blocks = (): Promise<string[]> =>
  page
    .evaluate(() => JSON.stringify((document.querySelector('.prose') as unknown as { editor: { getJSON: () => unknown } }).editor.getJSON()))
    .then((s) => {
      const list = ((JSON.parse(s) as J).content ?? []).map(short)
      while (list[list.length - 1] === 'paragraph') list.pop()
      return list
    })
const type = (text: string) => page.keyboard.type(text, { delay: 10 })
const press = (key: string) => page.keyboard.press(key)

async function newPage(title: string): Promise<void> {
  await press('Control+n')
  await expect(page.getByLabel('Title')).toBeFocused()
  await type(title)
  await press('Enter')
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('``` starts a code block, and / inside code is just text', async () => {
  await newPage('Code')
  await type('```')
  await type('chkdsk C: /f')
  await press('Enter')
  await type('sfc /scannow')
  await expect.poll(blocks).toEqual(['codeBlock("chkdsk C: /f\\nsfc /scannow")'])
  await expect(page.locator('.suggest-popup')).toHaveCount(0)
})

test('slash commands can be typed with spaces; a sentence starting with / stays text', async () => {
  await newPage('Slash')
  await type('/2 columns')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('2 columns')
  await press('Enter')
  await type('Left')
  await press('Tab') // next column
  await type('Right')
  await press('Shift+Tab')
  await type(' side')
  await expect.poll(blocks).toEqual(['columns(column(paragraph("Left side")) column(paragraph("Right")))'])
  await press('Control+End')
  await type('/etc/hosts is the file')
  await press('Enter')
  await type('next')
  await expect.poll(blocks).toEqual(['columns(column(paragraph("Left side")) column(paragraph("Right")))', 'paragraph("/etc/hosts is the file")', 'paragraph("next")'])
})

test('Tab in ordinary text stays on the page (it used to tick a checkbox)', async () => {
  await newPage('Tab')
  await type('[] Order battery')
  await press('Enter')
  await press('Enter')
  await type('Before')
  await press('Tab')
  await type(' after')
  await expect(page.locator('.prose')).toBeFocused()
  await expect.poll(blocks).toEqual(['taskList(taskItem(paragraph("Order battery")))', 'paragraph("Before after")'])
  await expect(page.locator('.prose input[type="checkbox"]').first()).not.toBeChecked()
})

test('Backspace at the start of a heading makes it normal text', async () => {
  await newPage('Heading')
  await type('Above')
  await press('Enter')
  await type('## Notes')
  await press('Home')
  await press('Backspace')
  await expect.poll(blocks).toEqual(['paragraph("Above")', 'paragraph("Notes")'])
})

test('Backspace below a toggle joins its last line instead of selecting the toggle', async () => {
  await newPage('Toggle backspace')
  await type('/toggle')
  await press('Enter')
  await type('Parts')
  await press('Enter')
  await type('Battery')
  await press('Enter')
  await press('Enter') // out of the toggle
  await type('more')
  await press('Home')
  await press('Backspace')
  await type('!')
  await expect.poll(blocks).toEqual(['details(detailsSummary("Parts") detailsContent(paragraph("Battery!more")))'])
  await shot(page, 'typing-toggle-backspace')
})

test('pasted plain text keeps its blank lines', async () => {
  await newPage('Paste text')
  await page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    document.querySelector('.prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, 'line 1\r\nline 2\r\n\r\nline 4\r\n')
  await expect.poll(blocks).toEqual(['paragraph("line 1")', 'paragraph("line 2")', 'paragraph', 'paragraph("line 4")'])
})
