import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import type { MoneyReport } from '../../../shared/api'
import { api } from '../api'
import { formatMoney, todayISO } from '../lib/format'
import { useUi } from '../store/ui'

type Span = 'quarter' | 'year'
const pad = (n: number): string => String(n).padStart(2, '0')
const lastDay = (y: number, m: number): number => new Date(y, m, 0).getDate()

/** The period containing \`anchor\` (YYYY-MM-DD), shifted by \`by\` quarters/years. */
function period(span: Span, anchor: string, by: number): { from: string; to: string; label: string; anchor: string } {
  const [y0, m0] = anchor.split('-').map(Number)
  if (span === 'year') {
    const y = y0 + by
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), anchor: `${y}-01-01` }
  }
  const q0 = Math.floor((m0 - 1) / 3) + by
  const y = y0 + Math.floor(q0 / 4)
  const q = ((q0 % 4) + 4) % 4
  const m1 = q * 3 + 1
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    from: `${y}-${pad(m1)}-01`,
    to: `${y}-${pad(m1 + 2)}-${lastDay(y, m1 + 2)}`,
    label: `Q${q + 1} ${y} · ${months[m1 - 1]}–${months[m1 + 1]}`,
    anchor: `${y}-${pad(m1)}-01`
  }
}

const monthShort = (ym: string): string => new Date(`${ym}-01T00:00`).toLocaleDateString(undefined, { month: 'short' })

/** Bars for each month; one or two series. */
function BarChart({ data, series, label }: { data: { month: string; values: number[] }[]; series: { name: string; className: string }[]; label: string }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values))
  const w = 640
  const h = 160
  const group = w / data.length
  const bar = Math.min(18, (group - 8) / series.length)
  return (
    <figure className="chart" aria-label={label}>
      <svg viewBox={`0 0 ${w} ${h + 20}`} role="img">
        <line x1="0" x2={w} y1={h} y2={h} className="chart-axis" />
        {data.map((d, i) =>
          d.values.map((v, s) => {
            const bh = (v / max) * (h - 8)
            const x = i * group + (group - bar * series.length) / 2 + s * bar
            return (
              <rect key={`${d.month}-${s}`} x={x} y={h - bh} width={bar - 2} height={Math.max(0, bh)} rx="2" className={series[s].className}>
                <title>{`${monthShort(d.month)}: ${series[s].name} ${series[s].className === 'bar-count' ? v : formatMoney(v)}`}</title>
              </rect>
            )
          })
        )}
        {data.map((d, i) => (
          <text key={d.month} x={i * group + group / 2} y={h + 15} textAnchor="middle" className="chart-label">
            {monthShort(d.month)}
          </text>
        ))}
      </svg>
      {series.length > 1 && (
        <figcaption className="chart-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i className={s.className} /> {s.name}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  )
}

export function MoneyReports() {
  const span = (useUi((s) => s.prefs.reportSpan) as Span | undefined) ?? 'quarter'
  const setPref = useUi((s) => s.setPref)
  const [anchor, setAnchor] = useState(todayISO())
  const [report, setReport] = useState<MoneyReport | null>(null)
  const p = period(span, anchor, 0)
  useEffect(() => {
    void api.money.report(p.from, p.to).then(setReport)
  }, [p.from, p.to])

  const g = report?.gst
  return (
    <div className="reports">
      <div className="tx-toolbar">
        <div className="month-picker">
          <button type="button" className="icon-btn" aria-label="Previous period" onClick={() => setAnchor(period(span, anchor, -1).anchor)}>
            <ChevronLeft />
          </button>
          <span className="month-label report-period">{p.label}</span>
          <button type="button" className="icon-btn" aria-label="Next period" onClick={() => setAnchor(period(span, anchor, 1).anchor)}>
            <ChevronRight />
          </button>
        </div>
        <div className="chips">
          {(['quarter', 'year'] as const).map((s) => (
            <button key={s} type="button" className={`chip-btn ${span === s ? 'active' : ''}`} onClick={() => setPref('reportSpan', s)}>
              {s === 'quarter' ? 'Quarter' : 'Year'}
            </button>
          ))}
        </div>
      </div>

      {g && report && (
        <>
          <section className="report-card gst-card">
            <h2 className="section-title">GST/HST for this period</h2>
            <div className="gst-grid">
              <div className="stat">
                <div className="stat-label">Collected on sales</div>
                <div className="stat-value">{formatMoney(g.collected)}</div>
                <div className="small muted">
                  from {formatMoney(g.sales)} in sales{report.taxRate ? ` at ${report.taxRate}%` : ''}
                  {g.exemptSales ? `, ${formatMoney(g.exemptSales)} with no tax` : ''}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Paid on expenses (ITCs)</div>
                <div className="stat-value">{formatMoney(g.paid)}</div>
                <div className="small muted">
                  from {formatMoney(g.expenses)} in expenses{report.purchaseTaxRate ? ` at ${report.purchaseTaxRate}%` : ''}
                </div>
              </div>
              <div className="stat gst-net">
                <div className="stat-label">{g.net >= 0 ? 'Net to remit' : 'Net refund'}</div>
                <div className="stat-value">{formatMoney(Math.abs(g.net))}</div>
                <div className="small muted">collected − paid</div>
              </div>
            </div>
            <p className="small muted report-note">
              <Info /> Worked out from what’s recorded in Plannr (prices include tax; “no tax” entries are left out). Check it against your books
              before filing.
            </p>
          </section>

          <section className="report-card">
            <h2 className="section-title">Income and expenses, last 12 months</h2>
            <BarChart
              label="Income and expenses per month"
              data={report.monthly.map((m) => ({ month: m.month, values: [m.income, m.expense] }))}
              series={[
                { name: 'Income', className: 'bar-income' },
                { name: 'Expenses', className: 'bar-expense' }
              ]}
            />
          </section>

          <div className="report-columns">
            <section className="report-card">
              <h2 className="section-title">Tickets per month</h2>
              <BarChart label="Tickets received per month" data={report.monthly.map((m) => ({ month: m.month, values: [m.tickets] }))} series={[{ name: 'Tickets', className: 'bar-count' }]} />
            </section>
            <section className="report-card">
              <h2 className="section-title">Tickets this period</h2>
              <dl className="report-stats">
                <dt>Received</dt>
                <dd>{report.repairs.count}</dd>
                <dt>Picked up</dt>
                <dd>{report.repairs.completed}</dd>
                <dt>Average turnaround</dt>
                <dd>{report.repairs.avgTurnaroundDays === null ? '—' : `${report.repairs.avgTurnaroundDays} days`}</dd>
                <dt>Average ticket</dt>
                <dd>{report.repairs.avgValueCents === null ? '—' : formatMoney(report.repairs.avgValueCents)}</dd>
              </dl>
              {report.repairs.topDevices.length > 0 && (
                <>
                  <h3 className="report-sub">Most common</h3>
                  <ol className="top-devices">
                    {report.repairs.topDevices.map((d) => (
                      <li key={d.name}>
                        <span>{d.name}</span>
                        <span className="muted">{d.count}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
