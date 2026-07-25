'use client'

function fmt(sec?: number | null) {
  if (sec == null) return '—'
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const SEV_STYLE: Record<string, string> = {
  critical: 'border-rose-400/40 bg-rose-500/15 text-rose-100',
  high: 'border-orange-400/35 bg-orange-500/10 text-orange-100',
  medium: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  low: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
}

export type DetectedEvent = {
  kind?: string
  label?: string
  severity?: string
  t_sec?: number
  at?: string
}

export function DetectedEvents({
  events,
  confidence,
  recommendation,
  durationSec,
}: {
  events: DetectedEvent[]
  confidence?: number | null
  recommendation?: string | null
  durationSec?: number | null
}) {
  return (
    <div className="rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-gold uppercase">Evidence intelligence</p>
          <p className="mt-1 text-sm text-ivory">Detected events</p>
        </div>
        {durationSec != null ? (
          <p className="font-mono text-xs text-muted">{fmt(durationSec)}</p>
        ) : null}
      </div>
      <ul className="mt-3 space-y-2">
        {(events || []).length === 0 && (
          <li className="text-xs text-muted">No threat keywords yet.</li>
        )}
        {(events || []).slice(-12).map((e, i) => (
          <li
            key={`${e.kind}-${e.t_sec}-${i}`}
            className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${
              SEV_STYLE[e.severity || 'medium'] || SEV_STYLE.medium
            }`}
          >
            <span>{e.label || e.kind}</span>
            <span className="font-mono opacity-80">{fmt(e.t_sec)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 text-xs">
        {confidence != null ? (
          <p className="text-soft">
            AI confidence <span className="text-ivory">{Math.round(confidence * 100)}%</span>
          </p>
        ) : null}
        {recommendation ? (
          <p className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-rose-100">
            Recommended action: {recommendation}
          </p>
        ) : null}
      </div>
    </div>
  )
}
