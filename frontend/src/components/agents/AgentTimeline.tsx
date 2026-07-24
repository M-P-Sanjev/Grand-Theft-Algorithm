'use client'

export type AgentLogItem = {
  at?: string
  agent?: string
  message?: string
  source?: string
  meta?: Record<string, unknown>
}

export type AgentPlanItem = {
  step?: number
  agent?: string
  action?: string
  rationale?: string
}

type Props = {
  plan?: AgentPlanItem[]
  log?: AgentLogItem[]
}

export function AgentTimeline({ plan = [], log = [] }: Props) {
  return (
    <div className="space-y-4">
      {!!plan.length && (
        <div>
          <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Agent plan</p>
          <ol className="mt-2 space-y-2">
            {plan.map((p, i) => (
              <li
                key={`${p.agent}-${i}`}
                className="rounded-2xl border border-ivory/10 bg-void/30 px-4 py-3 text-sm"
              >
                <span className="text-gold">{p.step ?? i + 1}. {p.agent}</span>
                <span className="text-soft/70"> — {p.action}</span>
                {p.rationale && (
                  <p className="mt-1 text-xs text-muted">{p.rationale}</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!!log.length && (
        <div>
          <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Timeline</p>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {[...log].reverse().map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className="rounded-2xl border border-ivory/5 bg-panel/40 px-4 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px] tracking-[0.16em] uppercase text-muted">
                  <span className="text-gold">{e.agent}</span>
                  {e.source && <span>{e.source}</span>}
                  {e.at && <span>{new Date(e.at).toLocaleString()}</span>}
                </div>
                <p className="mt-1 text-soft/90">{e.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!plan.length && !log.length && (
        <p className="text-sm text-muted">No agent activity yet.</p>
      )}
    </div>
  )
}
