import { describe, expect, it } from 'vitest'
import { accountsServerFor, decodeEntities, emailDocument, mailBaseFor, parseMessages, searchKeyFor } from '../../src/main/services/zoho'

describe('Zoho regions', () => {
  it('maps regions and data centres to the right servers', () => {
    expect(accountsServerFor('com')).toBe('https://accounts.zoho.com')
    expect(accountsServerFor('ca')).toBe('https://accounts.zohocloud.ca')
    expect(mailBaseFor('https://accounts.zoho.eu')).toBe('https://mail.zoho.eu')
    expect(mailBaseFor('https://accounts.zohocloud.ca')).toBe('https://mail.zohocloud.ca')
    expect(() => mailBaseFor('https://evil.example.com')).toThrow(/Unexpected Zoho server/)
  })
})

describe('Zoho messages', () => {
  const base = 'https://mail.zoho.com'
  const raw = [
    { messageId: 3, folderId: 10, subject: 'Re: iPhone screen', summary: 'Sounds good', sender: 'Jane Doe', fromAddress: '&quot;Jane Doe&quot; &lt;Jane@Example.com&gt;', toAddress: 'me@nanotech.com', receivedTime: '1791100000000', hasAttachment: '1' },
    { messageId: 2, folderId: 20, subject: 'Your repair quote', sender: 'Me', fromAddress: 'me@nanotech.com', toAddress: '&lt;jane@example.com&gt;', receivedTime: '1791000000000' },
    { messageId: 1, folderId: 10, subject: 'Newsletter mentioning jane@example.com in text', fromAddress: 'news@shop.com', toAddress: 'me@nanotech.com', receivedTime: '1791200000000' },
    { messageId: 2, folderId: 20, subject: 'duplicate', fromAddress: 'me@nanotech.com', toAddress: 'jane@example.com', receivedTime: '1' },
    { messageId: 4, folderId: 10, subject: 'Cc', fromAddress: 'boss@x.com', toAddress: 'me@nanotech.com', ccAddress: 'jane@example.com', receivedTime: '1790000000000' }
  ]

  it('keeps mail to/from/cc the customer only, newest first, without duplicates', () => {
    const list = parseMessages(raw, 'jane@example.com', base)
    expect(list.map((m) => [m.id, m.incoming])).toEqual([
      ['3', true],
      ['2', false],
      ['4', false]
    ])
    expect(list[0]).toMatchObject({
      subject: 'Re: iPhone screen',
      from: 'Jane Doe',
      hasAttachment: true,
      date: 1791100000000,
      link: 'https://mail.zoho.com/zm/#mail/folder/10/p/3'
    })
  })

  it('builds search keys and decodes entities', () => {
    expect(searchKeyFor(' jane@example.com ')).toBe('entire:jane@example.com')
    expect(decodeEntities('&quot;A &amp; B&quot; &lt;a@b.com&gt;')).toBe('"A & B" <a@b.com>')
  })

  it('wraps email HTML in a locked-down document (no scripts, no remote loads)', () => {
    const doc = emailDocument('<p>Hi</p><img src="https://tracker.example/pixel.gif">')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain('img-src data: cid:')
    expect(doc).toContain('<p>Hi</p>')
  })
})
