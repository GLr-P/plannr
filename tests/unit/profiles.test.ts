import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import { createCustomer } from '../../src/main/services/customers'
import { resolveFilePath, saveFile } from '../../src/main/services/files'
import { copyNoteTo, moveNoteTo } from '../../src/main/services/transfer'
import { search } from '../../src/main/services/search'
import { addProfile, loadRegistry, MAIN_PROFILE, profileDir, removeProfile, saveRegistry, updateProfile } from '../../src/main/profiles'
import type { DocJSON } from '../../src/shared/api'

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `plannr-${name}-`))

describe('profiles list', () => {
  it('starts with just the first profile, in the original data folder', () => {
    const base = temp('base')
    const reg = loadRegistry(base, 'Example Co')
    expect(reg.active).toBe(MAIN_PROFILE)
    expect(reg.profiles).toEqual([{ id: MAIN_PROFILE, name: 'Example Co', color: expect.stringMatching(/^#/) }])
    expect(profileDir(base, MAIN_PROFILE)).toBe(base)
  })

  it('adds, renames, switches and removes profiles; each has its own folder', () => {
    const base = temp('base')
    const reg = loadRegistry(base, 'First')
    const second = addProfile(base, reg, '  Other   Shop ')
    expect(second.name).toBe('Other Shop')
    expect(profileDir(base, second.id)).toBe(join(base, 'profiles', second.id))
    expect(existsSync(profileDir(base, second.id))).toBe(true)
    expect(() => addProfile(base, reg, 'other shop')).toThrow(/already/)
    expect(() => addProfile(base, reg, '   ')).toThrow(/name/)

    updateProfile(base, reg, second.id, { name: 'Other Co', color: '#16a34a' })
    reg.active = second.id
    saveRegistry(base, reg)
    const again = loadRegistry(base)
    expect(again.active).toBe(second.id)
    expect(again.profiles.map((p) => [p.name, p.color])).toEqual([
      ['First', reg.profiles[0].color],
      ['Other Co', '#16a34a']
    ])

    expect(() => removeProfile(base, again, MAIN_PROFILE)).toThrow(/first/)
    expect(() => removeProfile(base, again, second.id)).toThrow(/Switch/)
    again.active = MAIN_PROFILE
    const aside = removeProfile(base, again, second.id)
    expect(aside && existsSync(aside)).toBe(true)
    expect(existsSync(profileDir(base, second.id))).toBe(false)
    expect(loadRegistry(base).profiles.map((p) => p.id)).toEqual([MAIN_PROFILE])
  })

  it('a damaged list falls back to the first profile instead of failing', () => {
    const base = temp('base')
    writeFileSync(join(base, 'profiles.json'), '{ not json')
    expect(loadRegistry(base, 'Mine').profiles.map((p) => p.name)).toEqual(['Mine'])
    writeFileSync(join(base, 'profiles.json'), JSON.stringify({ active: 'gone', profiles: [{ id: '../evil', name: 'x' }] }))
    const reg = loadRegistry(base, 'Mine')
    expect(reg.active).toBe(MAIN_PROFILE)
    expect(reg.profiles.map((p) => p.id)).toEqual([MAIN_PROFILE])
  })
})

describe('copying notes between profiles', () => {
  const setup = () => {
    const a = { dir: temp('a'), db: null as never as ReturnType<typeof openDb> }
    const b = { dir: temp('b'), db: null as never as ReturnType<typeof openDb> }
    a.db = openDb(join(a.dir, 'plannr.db'))
    b.db = openDb(join(b.dir, 'plannr.db'))
    return { a, b }
  }

  it('copies the text, pictures and files into the other profile; @-links become text', () => {
    const { a, b } = setup()
    const customer = createCustomer(a.db, { name: 'Jane Example' })
    const img = saveFile(a.db, a.dir, { name: 'photo.png', mime: 'image/png', data: Buffer.from('PNGDATA') })
    const pdf = saveFile(a.db, a.dir, { name: 'invoice.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4') })
    const note = notes.createNote(a.db, { title: 'Supplier list' })
    const content: DocJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Call ' }, { type: 'mention', attrs: { id: customer.id, kind: 'customer', label: 'Jane Example' } }] },
        { type: 'image', attrs: { src: img.url, alt: 'photo.png' } },
        { type: 'image', attrs: { src: img.url, alt: 'same again' } },
        { type: 'fileAttachment', attrs: { src: pdf.url, name: 'invoice.pdf', size: 8, mime: 'application/pdf' } }
      ]
    }
    notes.updateNote(a.db, note.id, { content, tags: ['parts'], icon: 'truck' })

    const id = copyNoteTo(a, b, note.id)
    const copy = notes.getNote(b.db, id)!
    expect(copy.title).toBe('Supplier list')
    expect(copy.tags).toEqual(['parts'])
    expect(copy.icon).toBe('truck')
    const [para, image, image2, file] = copy.content!.content!
    expect(para.content).toEqual([{ type: 'text', text: 'Call ' }, { type: 'text', text: '@Jane Example' }])
    // New file ids in the other profile, with the same bytes; the same picture used twice is copied once
    const newImg = /plannr:\/\/file\/(.+)$/.exec(String(image.attrs!.src))![1]
    expect(image.attrs!.src).not.toBe(img.url)
    expect(image2.attrs!.src).toBe(image.attrs!.src)
    expect(readFileSync(resolveFilePath(b.db, b.dir, newImg)!.path, 'utf8')).toBe('PNGDATA')
    const newPdf = /plannr:\/\/file\/(.+)$/.exec(String(file.attrs!.src))![1]
    expect(readFileSync(resolveFilePath(b.db, b.dir, newPdf)!.path, 'utf8')).toBe('%PDF-1.4')
    expect(resolveFilePath(b.db, b.dir, img.id)).toBeNull() // nothing points back into the first profile
    // Searchable over there; the original is untouched
    expect(search(b.db, 'supplier').map((r) => r.id)).toContain(id)
    expect(notes.getNote(a.db, note.id)!.deletedAt).toBeNull()
  })

  it('moving puts the original in the trash', () => {
    const { a, b } = setup()
    const note = notes.createNote(a.db, { title: 'Move me' })
    const id = moveNoteTo(a, b, note.id)
    expect(notes.getNote(b.db, id)!.title).toBe('Move me')
    expect(notes.getNote(a.db, note.id)!.deletedAt).not.toBeNull()
  })
})
