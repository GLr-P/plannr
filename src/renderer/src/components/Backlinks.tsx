import { useEffect, useState } from 'react'
import type { Backlink } from '../../../shared/api'
import { api } from '../api'
import { openEntity } from '../actions'
import { noteTitle } from '../lib/format'
import { EntityIcon } from './EntityIcon'

/** "Linked from": notes and tickets that @-mention this item. */
export function Backlinks({ id }: { id: string }) {
  const [links, setLinks] = useState<Backlink[]>([])
  useEffect(() => {
    void api.links.backlinks(id).then(setLinks)
  }, [id])
  if (!links.length) return null
  return (
    <section className="backlinks">
      <h3>Linked from</h3>
      {links.map((b) => (
        <button key={b.id} type="button" className="backlink" onClick={() => openEntity(b.type, b.id)}>
          <EntityIcon type={b.type} /> {noteTitle(b.title)}
        </button>
      ))}
    </section>
  )
}
