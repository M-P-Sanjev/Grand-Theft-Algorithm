'use client'

import { motion } from 'framer-motion'

export type RiskScores = {
  physical_safety?: number
  emotional_distress?: number
  threat_escalation?: number
  child_safety?: number
  isolation?: number
  medical_risk?: number
  self_harm_concern?: number
  weapon_risk?: number
  stalking?: number
  financial_abuse?: number
  urgency?: number
  overall?: number
}

type RiskPoint = { at?: string; score?: number; tier?: string }

type Props = {
  score?: number
  tier?: string
  confidence?: number
  reasons?: string[]
  scores?: RiskScores
  recommendation?: string
  trend?: string
  delta?: number
  history?: RiskPoint[]
  calculating?: boolean
}

const BARS: { key: keyof RiskScores; label: string }[] = [
  { key: 'physical_safety', label: 'Physical Safety' },
  { key: 'emotional_distress', label: 'Emotional Distress' },
  { key: 'threat_escalation', label: 'Threat Escalation' },
  { key: 'child_safety', label: 'Child Safety' },
  { key: 'isolation', label: 'Isolation' },
  { key: 'medical_risk', label: 'Medical Risk' },
  { key: 'self_harm_concern', label: 'Self Harm' },
]

function tierColor(tier?: string) {
  const t = (tier || '').toUpperCase()
  if (t === 'CRITICAL') return 'text-red-300 border-red-400/40 bg-red-500/10'
  if (t === 'HIGH') return 'text-orange-200 border-orange-400/40 bg-orange-500/10'
  if (t === 'MEDIUM') return 'text-amber-100 border-amber-400/35 bg-amber-500/10'
  return 'text-emerald-200 border-emerald-400/35 bg-emerald-500/10'
}

export function RiskPanel({
  score = 0,
  tier = 'LOW',
  confidence,
  reasons,
  scores,
  recommendation,
  trend,
  delta,
  history,
  calculating,
}: Props) {
  const pts = (history || []).map((h) => Number(h.score || 0)).filter((n) => !Number.isNaN(n))
  const trendLabel =
    trend === 'increasing' ? '⬆ Escalating' : trend === 'decreasing' ? '⬇ Decreasing' : '→ Stable'

  return (
    <div className="max-h-96 overflow-y-auto rounded-[1.35rem] border border-ivory/10 bg-void/45 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-muted uppercase">
            Risk breakdown
          </p>
          <p className="mt-1 text-xs text-soft/70">Live feature classifier · updates in realtime</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] tracking-[0.14em] uppercase ${tierColor(tier)}`}>
          {tier}
          {typeof confidence === 'number' ? ` · ${Math.round(confidence * 100)}%` : ''}
        </span>
      </div>

      <div className="mt-5 flex items-end gap-4">
        <div>
          <p className="text-[10px] tracking-[0.16em] text-muted uppercase">Overall risk</p>
          <motion.p
            key={calculating ? 'calc' : score}
            initial={{ opacity: 0.4, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="font-display text-5xl text-ivory"
          >
            {calculating ? '…' : score}
            <span className="ml-1 text-lg text-muted">/ 100</span>
          </motion.p>
          <p className="mt-1 text-xs text-gold-soft">
            {trendLabel}
            {typeof delta === 'number' && delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}
          </p>
        </div>
        {pts.length > 1 && (
          <RiskSparkline values={pts} className="mb-2 h-14 flex-1" />
        )}
      </div>

      <div className="mt-5 space-y-2.5">
        {BARS.map(({ key, label }) => {
          const v = Number(scores?.[key] ?? 0)
          return (
            <div key={key}>
              <div className="mb-1 flex justify-between text-[10px] tracking-[0.12em] text-muted uppercase">
                <span>{label}</span>
                <span>{v}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ivory/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-gold/70 to-red-400/80"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, v)}%` }}
                  transition={{ duration: calculating ? 1.2 : 0.55 }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {!!reasons?.length && (
        <ul className="mt-5 space-y-1 border-t border-ivory/10 pt-4 text-sm text-soft/85">
          {reasons.slice(0, 6).map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}
      {recommendation && (
        <p className="mt-4 rounded-xl border border-gold/25 bg-gold/10 px-3 py-2 text-xs text-gold-soft">
          Recommend · {recommendation}
        </p>
      )}
    </div>
  )
}

function RiskSparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 160
  const h = 48
  const max = Math.max(100, ...values)
  const min = 0
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w
      const y = h - ((v - min) / (max - min || 1)) * h
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <polyline
        fill="none"
        stroke="rgba(212,165,116,0.9)"
        strokeWidth="2.5"
        points={pts}
      />
    </svg>
  )
}
