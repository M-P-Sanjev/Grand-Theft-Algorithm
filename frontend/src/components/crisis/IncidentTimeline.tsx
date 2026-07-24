'use client'

import { AnimatePresence, motion } from 'framer-motion'

export type TimelineItem = {
  at: string
  event: string
  detail?: string
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function IncidentTimeline({ items }: { items?: TimelineItem[] }) {
  const list = [...(items || [])].reverse()

  return (
    <div className="rounded-[1.35rem] border border-ivory/10 bg-void/40 p-5">
      <p className="text-[10px] tracking-[0.22em] text-muted uppercase">Incident timeline</p>
      <p className="mt-1 text-xs text-soft/65">Updates automatically with every event</p>

      {!list.length ? (
        <p className="mt-4 text-sm text-muted">No events yet.</p>
      ) : (
        <ol className="mt-5 max-h-72 space-y-0 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {list.map((item, i) => (
              <motion.li
                key={`${item.at}-${item.event}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {i < list.length - 1 && (
                  <span className="absolute top-3 left-[7px] h-[calc(100%-4px)] w-px bg-ivory/15" />
                )}
                <span className="relative z-[1] mt-1 h-3.5 w-3.5 shrink-0 rounded-full border border-gold/50 bg-gold/30" />
                <div>
                  <p className="text-[10px] tracking-[0.14em] text-gold-soft uppercase">
                    {formatTime(item.at)}
                  </p>
                  <p className="mt-0.5 text-sm text-ivory">{item.event}</p>
                  {item.detail && (
                    <p className="mt-0.5 text-xs text-soft/70">{item.detail}</p>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </div>
  )
}
