import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Images, X } from 'lucide-react'
import type { PhotoKind, TicketPhoto } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { imageFiles, pickImages, storeFile } from '../editor/upload'
import { ConfirmButton } from './common'

const PHOTO_MIME = 'application/x-plannr-photo'
const KIND_LABEL: Record<PhotoKind, string> = { before: 'Before', after: 'After' }

/** Before/after photo galleries for a ticket, in a collapsible section (collapsed by default). */
export function PhotoGallery({ ticketId, onChange }: { ticketId: string; onChange?: () => void }) {
  const [photos, setPhotos] = useState<TicketPhoto[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const key = `photos:${ticketId}`
  const open = useUi((s) => s.collapsed[key] === false) // collapsed unless opened
  const setCollapsed = useUi((s) => s.setCollapsed)

  useEffect(() => {
    void api.photos.list(ticketId).then(setPhotos)
  }, [ticketId])

  const add = useCallback(
    async (files: File[], kind: PhotoKind) => {
      if (!files.length) return
      setBusy(true)
      try {
        const stored = []
        for (const f of files) stored.push(await storeFile(f))
        setPhotos(await api.photos.add(ticketId, stored.map((s) => s.id), kind))
        onChange?.()
      } finally {
        setBusy(false)
      }
    },
    [ticketId, onChange]
  )

  const move = async (id: string, kind: PhotoKind): Promise<void> => {
    await api.photos.setKind(id, kind)
    setPhotos(await api.photos.list(ticketId))
  }

  const remove = async (id: string): Promise<void> => {
    await api.photos.remove(id)
    setPhotos(await api.photos.list(ticketId))
    onChange?.()
  }

  const ordered = [...photos.filter((p) => p.kind === 'before'), ...photos.filter((p) => p.kind === 'after')]
  const count = (kind: PhotoKind): number => photos.filter((p) => p.kind === kind).length
  const summary = photos.length ? `${count('before')} before · ${count('after')} after` : 'None yet'

  return (
    <section className={`photos ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="photos-header"
        aria-expanded={open}
        onClick={() => setCollapsed(key, open)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) setCollapsed(key, false) // open when files are dragged over
        }}
      >
        {open ? <ChevronDown /> : <ChevronRight />}
        <Images />
        <span className="photos-title">Photos</span>
        <span className="photos-summary">{summary}</span>
        {busy && <span className="photos-summary">Adding…</span>}
      </button>
      {open && (
        <div className="photo-columns">
          {(['before', 'after'] as const).map((kind) => (
            <PhotoColumn
              key={kind}
              kind={kind}
              photos={photos.filter((p) => p.kind === kind)}
              onAdd={(files) => void add(files, kind)}
              onMove={(id) => void move(id, kind)}
              onRemove={(id) => void remove(id)}
              onSwap={(p) => void move(p.id, p.kind === 'before' ? 'after' : 'before')}
              onOpen={(p) => setViewing(ordered.findIndex((o) => o.id === p.id))}
            />
          ))}
        </div>
      )}
      {viewing !== null && ordered[viewing] && (
        <Lightbox photos={ordered} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </section>
  )
}

function PhotoColumn(props: {
  kind: PhotoKind
  photos: TicketPhoto[]
  onAdd: (files: File[]) => void
  onMove: (photoId: string) => void
  onRemove: (photoId: string) => void
  onSwap: (photo: TicketPhoto) => void
  onOpen: (photo: TicketPhoto) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`photo-column ${over ? 'drop-over' : ''}`}
      data-kind={props.kind}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(PHOTO_MIME)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const photoId = e.dataTransfer.getData(PHOTO_MIME)
        if (photoId) props.onMove(photoId)
        else props.onAdd(imageFiles(e.dataTransfer.files))
      }}
    >
      <div className="photo-column-title">
        {KIND_LABEL[props.kind]} <span className="muted">{props.photos.length || ''}</span>
      </div>
      <div className="photo-grid">
        {props.photos.map((p) => (
          <div
            key={p.id}
            className="thumb"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(PHOTO_MIME, p.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <button type="button" className="thumb-open" onClick={() => props.onOpen(p)} aria-label={`View ${p.name}`}>
              <img src={p.url} alt={p.name} loading="lazy" decoding="async" draggable={false} />
            </button>
            <span className="thumb-actions">
              <button
                type="button"
                className="icon-btn sm"
                title={`Move to ${props.kind === 'before' ? 'After' : 'Before'}`}
                aria-label="Move to other side"
                onClick={() => props.onSwap(p)}
              >
                <ArrowLeftRight />
              </button>
              <ConfirmButton title="Remove photo" onConfirm={() => props.onRemove(p.id)} />
            </span>
          </div>
        ))}
        <button
          type="button"
          className="thumb add-tile"
          onClick={() => void pickImages().then(props.onAdd)}
          aria-label={`Add ${props.kind} photos`}
        >
          <ImagePlus />
          <span>Add or drop</span>
        </button>
      </div>
    </div>
  )
}

function Lightbox({
  photos,
  index,
  onIndex,
  onClose
}: {
  photos: TicketPhoto[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const photo = photos[index]
  const prev = useCallback(() => onIndex((index - 1 + photos.length) % photos.length), [index, photos.length, onIndex])
  const next = useCallback(() => onIndex((index + 1) % photos.length), [index, photos.length, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, prev, next])

  return (
    <div className="lightbox" role="dialog" aria-label="Photo viewer" onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>
          <strong>{KIND_LABEL[photo.kind]}</strong> · {index + 1} of {photos.length} · {photo.name}
        </span>
        <span className="lightbox-actions">
          <button type="button" className="icon-btn" title="Open in Photos app (zoom)" aria-label="Open in Photos app" onClick={() => void api.files.open(photo.fileId)}>
            <ExternalLink />
          </button>
          <button type="button" className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </span>
      </div>
      {photos.length > 1 && (
        <button type="button" className="lightbox-nav left" aria-label="Previous photo" onClick={(e) => (e.stopPropagation(), prev())}>
          <ChevronLeft />
        </button>
      )}
      <img src={photo.url} alt={photo.name} onClick={(e) => e.stopPropagation()} />
      {photos.length > 1 && (
        <button type="button" className="lightbox-nav right" aria-label="Next photo" onClick={(e) => (e.stopPropagation(), next())}>
          <ChevronRight />
        </button>
      )}
    </div>
  )
}
