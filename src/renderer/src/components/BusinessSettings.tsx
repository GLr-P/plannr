import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { BusinessInfo } from '../../../shared/api'
import { api } from '../api'

const LABEL_SIZES: { id: BusinessInfo['labelSize']; name: string }[] = [
  { id: '62x29mm', name: 'Brother 62 × 29 mm' },
  { id: '2.25x1.25in', name: 'Dymo 2¼ × 1¼ in' },
  { id: '4x6in', name: 'Shipping label 4 × 6 in' }
]

/** Settings: business details printed on intake slips, receipts and labels. Each field saves when you leave it. */
export function BusinessSettings() {
  const [info, setInfo] = useState<BusinessInfo | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void api.business.get().then(setInfo)
  }, [])
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(t)
  }, [saved])
  if (!info) return null

  const save = async (patch: Partial<BusinessInfo>): Promise<void> => {
    setInfo(await api.business.set(patch))
    setSaved(true)
  }
  const text = (key: keyof BusinessInfo, label: string, opts: { area?: boolean; placeholder?: string; wide?: boolean } = {}) => {
    const props = {
      value: String(info[key] ?? ''),
      placeholder: opts.placeholder,
      'aria-label': label,
      onChange: (e: { target: { value: string } }) => setInfo({ ...info, [key]: e.target.value }),
      onBlur: (e: { target: { value: string } }) => void save({ [key]: key === 'taxRate' ? Number(e.target.value) || 0 : e.target.value })
    }
    return (
      <label className={`mfield ${opts.wide ? 'wide' : ''}`}>
        {label}
        {opts.area ? <textarea rows={3} {...props} /> : <input {...props} inputMode={key === 'taxRate' ? 'decimal' : undefined} />}
      </label>
    )
  }

  return (
    <section className="setting business-setting">
      <div className="integration-main">
        <h3>
          Business details {saved && <span className="small muted saved-flash">Saved</span>}
        </h3>
        <p className="muted">Printed on intake slips, receipts and device labels (Print on a ticket).</p>
        <div className="business-grid">
          <div className="mfield wide logo-field">
            Logo
            <div className="logo-row">
              {info.logoFileId ? (
                <>
                  <img src={`plannr://file/${info.logoFileId}`} alt="Logo" className="logo-preview" />
                  <button type="button" className="btn sm" onClick={() => void save({ logoFileId: null })}>
                    <X /> Remove
                  </button>
                </>
              ) : (
                <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus /> Add logo
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                aria-label="Logo file"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const stored = await api.files.save({ name: f.name, mime: f.type || 'image/png', data: new Uint8Array(await f.arrayBuffer()) })
                  await save({ logoFileId: stored.id })
                }}
              />
            </div>
          </div>
          {text('name', 'Business name', { placeholder: 'e.g. Nano Tech Services' })}
          {text('phone', 'Phone')}
          {text('email', 'Email')}
          {text('website', 'Website')}
          {text('address', 'Address', { area: true, wide: true })}
          {text('taxName', 'Tax name', { placeholder: 'GST, HST…' })}
          {text('taxRate', 'Tax rate (%)')}
          {text('taxNumber', 'GST/HST number')}
          <label className="mfield">
            Label size
            <select value={info.labelSize} onChange={(e) => void save({ labelSize: e.target.value as BusinessInfo['labelSize'] })} aria-label="Label size">
              {LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {text('intakeTerms', 'Terms on the intake slip', { area: true, wide: true, placeholder: 'e.g. Devices left over 60 days after we call may be recycled. We are not responsible for data loss.' })}
          {text('receiptNote', 'Note at the bottom of receipts', { area: true, wide: true })}
        </div>
      </div>
    </section>
  )
}
