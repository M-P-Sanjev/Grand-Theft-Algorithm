'use client'

import { motion } from 'framer-motion'

type LiveStatus = {
  analysing?: boolean
  severity_detected?: string
  risk_index?: number
  resources_found?: boolean
  police_notified?: boolean
  ngo_assigned?: boolean
  lawyer_assigned?: boolean
  safe_house_found?: boolean
  plain?: string
}

type Props = {
  status?: LiveStatus | null
  summary?: {
    headline?: string
    victim_profile?: string[]
    recommended?: string[]
    plain_status?: string
  } | null
  nextActions?: { id: string; label: string; plain: string }[] | null
}

const CHECKS: { key: keyof LiveStatus; label: string }[] = [
  { key: 'analysing', label: 'AI is analysing…' },
  { key: 'severity_detected', label: 'Danger level detected' },
  { key: 'resources_found', label: 'Support resources found' },
  { key: 'police_notified', label: 'Police route opened' },
  { key: 'ngo_assigned', label: 'Support person assigned' },
  { key: 'lawyer_assigned', label: 'Legal helper flagged' },
  { key: 'safe_house_found', label: 'Safe place options ready' },
]

export function VictimLiveBoard({ status, summary, nextActions }: Props) {
  return (
    <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
      <div className="rounded-[1.5rem] border border-gold/25 bg-gold/5 p-5">
        <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Your case right now</p>
        <p className="mt-2 text-lg text-ivory">
          {summary?.plain_status || status?.plain || 'We are with you.'}
        </p>
        {summary?.headline && (
          <p className="mt-2 text-sm text-gold-soft">{summary.headline}</p>
        )}
        {typeof status?.risk_index === 'number' && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[10px] tracking-[0.16em] text-muted uppercase">
              <span>Risk index</span>
              <span>{status.risk_index}/100</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-void/60">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, status.risk_index)}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
          </div>
        )}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {CHECKS.map((c) => {
          const raw = status?.[c.key]
          const on =
            c.key === 'analysing'
              ? Boolean(raw)
              : c.key === 'severity_detected'
                ? Boolean(raw)
                : Boolean(raw)
          const detail =
            c.key === 'severity_detected' && typeof raw === 'string' ? ` · ${raw}` : ''
          return (
            <li
              key={c.key}
              className={`rounded-2xl border px-4 py-3 text-sm ${
                on
                  ? 'border-gold/30 bg-gold/10 text-gold-soft'
                  : 'border-ivory/10 text-muted'
              }`}
            >
              <span className="mr-2">{on ? '●' : '○'}</span>
              {c.label}
              {detail}
            </li>
          )
        })}
      </ul>

      {!!summary?.victim_profile?.length && (
        <div className="rounded-[1.5rem] border border-ivory/10 p-5">
          <p className="text-[10px] tracking-[0.18em] text-muted uppercase">What we understood</p>
          <ul className="mt-3 space-y-1 text-sm text-soft/90">
            {summary.victim_profile.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      )}

      {!!nextActions?.length && (
        <div className="rounded-[1.5rem] border border-ivory/10 p-5">
          <p className="text-[10px] tracking-[0.18em] text-muted uppercase">Suggested next help</p>
          <ul className="mt-3 space-y-2">
            {nextActions.slice(0, 4).map((a) => (
              <li key={a.id} className="text-sm text-soft/90">
                <span className="text-gold-soft">{a.label}</span>
                <span className="text-muted"> — {a.plain}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
