'use client'

import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/lib/constants'

export type LiveEvent = {
  type: string
  case_id?: string
  stage?: string
  detail?: Record<string, unknown>
  risk_score?: number
  risk_tier?: string
  ai_summary?: Record<string, unknown>
  next_actions?: unknown
  live_status?: Record<string, unknown>
  role?: string
  online?: boolean
  active?: boolean
  [key: string]: unknown
}

function wsUrl(caseId?: string, role = 'admin') {
  const base = API_BASE.replace(/^http/, 'ws')
  const q = new URLSearchParams()
  if (caseId) q.set('case_id', caseId)
  q.set('role', role)
  return `${base}/ws/live?${q.toString()}`
}

export function useLiveSocket(opts: {
  caseId?: string
  role?: string
  enabled?: boolean
  onEvent?: (ev: LiveEvent) => void
}) {
  const { caseId, role = 'admin', enabled = true, onEvent } = opts
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)
  const [pipelineStages, setPipelineStages] = useState<
    { id: string; label: string; done?: boolean; active?: boolean }[]
  >([])
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (closed) return
      ws = new WebSocket(wsUrl(caseId, role))
      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 2500)
      }
      ws.onerror = () => ws?.close()
      ws.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data) as LiveEvent
          if (ev.type === 'ping') return
          setLastEvent(ev)
          if (ev.type === 'pipeline_stage' && ev.stage) {
            const label =
              (typeof ev.label === 'string' && ev.label) ||
              (typeof ev.detail === 'object' && ev.detail && 'primary' in ev.detail
                ? `Feeling: ${String((ev.detail as { primary?: string }).primary)}`
                : ev.stage.replace(/_/g, ' '))
            setPipelineStages((prev) => {
              const next = prev.map((s) => ({ ...s, active: false, done: true }))
              const exists = next.find((s) => s.id === ev.stage)
              if (exists) {
                return next.map((s) =>
                  s.id === ev.stage ? { ...s, label, active: true, done: true } : s,
                )
              }
              return [...next, { id: ev.stage!, label, active: true, done: true }]
            })
          }
          onEventRef.current?.(ev)
        } catch {
          /* ignore */
        }
      }
    }
    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [caseId, role, enabled])

  return { connected, lastEvent, pipelineStages, setPipelineStages }
}
