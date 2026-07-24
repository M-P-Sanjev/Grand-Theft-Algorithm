'use client'

import { motion, AnimatePresence } from 'framer-motion'

export type PipelineStage = {
  id: string
  label: string
  active?: boolean
  done?: boolean
}

const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'incoming_note', label: 'Heard you' },
  { id: 'emotion_detected', label: 'Feeling understood' },
  { id: 'severity_prediction', label: 'Danger level checked' },
  { id: 'safety_plan', label: 'Safety step ready' },
  { id: 'laws_retrieved', label: 'Rights found' },
  { id: 'resources_found', label: 'Support found' },
  { id: 'ngo_assigned', label: 'Helper assigned' },
  { id: 'police_notified', label: 'Emergency route' },
  { id: 'dashboard_updated', label: 'Team updated' },
]

type Props = {
  stages?: PipelineStage[]
  title?: string
  riskIndex?: number
  tier?: string
}

export function CrisisPipeline({
  stages,
  title = 'Live AI pipeline',
  riskIndex,
  tier,
}: Props) {
  const list = stages?.length ? stages : DEFAULT_STAGES
  return (
    <div className="max-h-64 overflow-y-auto rounded-[1.5rem] border border-ivory/10 bg-void/50 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-muted uppercase">{title}</p>
          <p className="mt-1 text-sm text-soft/80">Crisis command — not a chatbot dump</p>
        </div>
        {(tier || typeof riskIndex === 'number') && (
          <div className="rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs text-gold-soft">
            {tier || '—'}
            {typeof riskIndex === 'number' ? ` · ${riskIndex}/100` : ''}
          </div>
        )}
      </div>
      <ol className="mt-5 space-y-0">
        <AnimatePresence initial={false}>
          {list.map((s, i) => (
            <motion.li
              key={s.id + s.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {i < list.length - 1 && (
                <span className="absolute top-3 left-[9px] h-[calc(100%-6px)] w-px bg-ivory/15" />
              )}
              <span
                className={`relative z-[1] mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border ${
                  s.done || s.active
                    ? 'border-gold bg-gold shadow-[0_0_12px_rgba(212,175,55,0.45)]'
                    : 'border-ivory/25 bg-void'
                }`}
              />
              <div>
                <p
                  className={`text-sm ${
                    s.active ? 'text-gold-soft' : s.done ? 'text-ivory' : 'text-muted'
                  }`}
                >
                  {s.label}
                </p>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}
