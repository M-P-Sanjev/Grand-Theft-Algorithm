'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ADMIN_KEY_STORAGE,
  API_BASE,
  SITE,
} from '@/lib/constants'
import { AgentTimeline, AgentLogItem, AgentPlanItem } from '@/components/agents/AgentTimeline'
import { AiChatPanel } from '@/components/agents/AiChatPanel'
import { SecureMessageForm } from '@/components/agents/SecureMessageForm'
import { CrisisPipeline } from '@/components/crisis/CrisisPipeline'
import { VictimLiveBoard } from '@/components/crisis/VictimLiveBoard'
import { RiskPanel } from '@/components/crisis/RiskPanel'
import { IncidentTimeline } from '@/components/crisis/IncidentTimeline'
import { motion } from 'framer-motion'
import { useLiveSocket, type LiveEvent } from '@/hooks/useLiveSocket'
import { LiveTranscriptPanel } from '@/components/guardian/LiveTranscriptPanel'
import { EvidencePlayer } from '@/components/guardian/EvidencePlayer'
import { DetectedEvents } from '@/components/guardian/DetectedEvents'

const CasesMap = dynamic(
  () => import('@/components/admin/CasesMap').then((m) => m.CasesMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center rounded-[1.25rem] border border-ivory/10 text-sm text-soft md:h-[480px]">
        Loading map…
      </div>
    ),
  },
)

type CaseRow = {
  id: string
  public_id?: string
  notes: string
  frequency: string
  severity: string
  name: string
  phone?: string | null
  location?: string | null
  lat?: number | null
  lng?: number | null
  location_updated_at?: string | null
  status: string
  routing: 'admin' | 'ngo' | 'police'
  risk_score?: number | null
  risk_tier?: string | null
  pipeline_status?: string
  pipeline?: { status?: string; stages?: { stage: string; label?: string }[] }
  escalation_contacts?: Record<string, string>
  agent_plan?: AgentPlanItem[]
  agent_log?: AgentLogItem[]
  legal_brief?: { answer?: string; sources?: unknown[] }
  therapy_brief?: { answer?: string }
  notify_status?: string
  privacy?: { redacted_preview?: boolean }
  created_at: string
  ai_summary?: {
    headline?: string
    victim_profile?: string[]
    recommended?: string[]
    plain_status?: string
  }
  next_actions?: { id: string; label: string; plain: string }[]
  live_status?: Record<string, unknown>
  crisis?: {
    tier?: string
    reasons?: string[]
    scores?: Record<string, number>
    confidence?: number
    trend?: string
    delta?: number
    emotion?: { primary?: string }
    recommendation?: string
  }
  safety_plan?: { primary_step?: string }
  timeline?: { at: string; event: string; detail?: string }[]
  risk_history?: { at?: string; score?: number; tier?: string }[]
  last_ai_action?: string
  ai_recommendation?: string
  last_activity_at?: string
  updated_at?: string
  location_privacy?: {
    accuracy_band?: string
    accuracy_m?: number
    live_tracking?: boolean
    hide_exact?: boolean
    city?: string
    state?: string
    label?: string
    nearest_eta_min?: number
    nearest_kind?: string
  }
  source?: string
  evidence?: {
    id?: string
    stored_as?: string
    filename?: string
    sha256?: string
    bytes?: number
    size?: number
    duration_sec?: number
    encrypted_at_rest?: boolean
    uploaded_at?: string
    pending?: boolean
  }[]
  guardian?: {
    active?: boolean
    recording?: boolean
    stealth?: boolean
    activated_at?: string
    transcript?: { text?: string; at?: string; t_sec?: number; final?: boolean }[]
    transcript_tail?: { text?: string; at?: string; t_sec?: number; final?: boolean }[]
    detected_events?: {
      kind?: string
      label?: string
      severity?: string
      t_sec?: number
      at?: string
    }[]
    live_summary?: string
    recording_meta?: {
      evidence_id?: string
      sha256?: string
      bytes?: number
      duration_sec?: number
      encrypted_at_rest?: boolean
    }
    evidence_pending?: boolean
    contacts_notified?: boolean
  }
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const FREQUENCY_RANK: Record<string, number> = {
  ongoing: 0,
  repeated: 1,
  once: 2,
}

function sortByPriority(cases: CaseRow[]) {
  return [...cases].sort((a, b) => {
    const openA = a.status === 'open' ? 0 : 1
    const openB = b.status === 'open' ? 0 : 1
    if (openA !== openB) return openA - openB
    if (typeof a.risk_score === 'number' && typeof b.risk_score === 'number') {
      if (b.risk_score !== a.risk_score) return b.risk_score - a.risk_score
    } else {
      const s = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
      if (s !== 0) return s
    }
    const f = (FREQUENCY_RANK[a.frequency] ?? 9) - (FREQUENCY_RANK[b.frequency] ?? 9)
    if (f !== 0) return f
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function aliasOf(c: CaseRow) {
  const raw = (c.name || '').trim()
  const idTail = (c.public_id || c.id || '').replace(/\D/g, '').slice(-4) || '1000'
  if (!raw || /^anonymous$/i.test(raw) || raw === 'A.' || /^[A-Z]\.?$/i.test(raw)) {
    return `Anonymous #${idTail}`
  }
  // First name only — never full name dump
  return raw.split(/\s+/)[0]
}

function locationLabel(c: CaseRow) {
  const priv = c.location_privacy
  if (priv?.city && priv?.state) return `${priv.city}`
  if (priv?.label) return priv.label.split(',').slice(0, 2).join(',').trim()
  if (c.location) return c.location.split(',').slice(0, 2).join(',').trim()
  if (typeof c.lat === 'number') return 'Approximate'
  return '—'
}

function lastMessage(c: CaseRow) {
  const n = (c.notes || '').trim()
  if (!n) return '—'
  return n.length > 48 ? `${n.slice(0, 47)}…` : n
}

function aiRec(c: CaseRow) {
  return (
    c.ai_recommendation ||
    c.crisis?.recommendation ||
    (c.risk_tier === 'critical' || c.crisis?.tier === 'CRITICAL'
      ? 'Immediate Response'
      : c.last_ai_action || '—')
  )
}

function incidentId(c: CaseRow) {
  if (c.public_id) return c.public_id
  return `HVN-${c.id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0000'}`
}

function ageLabel(iso?: string) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function timeLabel(iso?: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

type GuardianState = NonNullable<CaseRow['guardian']>
type TranscriptLine = { text?: string; at?: string; t_sec?: number; final?: boolean }

function transcriptKey(line: TranscriptLine) {
  return `${(line.text || '').trim().toLowerCase()}|${line.final === false ? 'p' : 'f'}`
}

function unionTranscript(a: TranscriptLine[] = [], b: TranscriptLine[] = [], cap = 80) {
  const out: TranscriptLine[] = []
  for (const line of [...a, ...b]) {
    const text = (line.text || '').trim().replace(/\s+/g, ' ')
    if (!text) continue
    const next: TranscriptLine = {
      text,
      at: line.at,
      t_sec: line.t_sec,
      final: line.final !== false,
    }
    const last = out[out.length - 1]
    if (last && last.final === false) {
      // Replace growing partial slot
      out[out.length - 1] = { ...next, at: last.at || next.at }
      continue
    }
    if (last && (last.text || '').toLowerCase() === text.toLowerCase() && last.final !== false) {
      continue
    }
    out.push(next)
  }
  return out.slice(-cap)
}

/** Never replace a richer guardian transcript with an empty/stale payload. */
function mergeGuardianClient(
  existing?: GuardianState | null,
  incoming?: GuardianState | null,
): GuardianState | undefined {
  if (!existing && !incoming) return undefined
  if (!incoming) return existing || undefined
  if (!existing) return incoming

  const transcript = unionTranscript(
    existing.transcript || existing.transcript_tail || [],
    incoming.transcript || incoming.transcript_tail || [],
  )
  const fromIncomingTail = incoming.transcript_tail || []
  const transcript_tail =
    fromIncomingTail.length > 0
      ? unionTranscript(existing.transcript_tail || existing.transcript || [], fromIncomingTail, 12)
      : transcript.slice(-12)

  const evSeen = new Set<string>()
  const detected_events: NonNullable<GuardianState['detected_events']> = []
  for (const ev of [...(existing.detected_events || []), ...(incoming.detected_events || [])]) {
    const key = `${ev.kind}|${ev.t_sec}|${ev.label}`
    if (evSeen.has(key)) continue
    evSeen.add(key)
    detected_events.push(ev)
  }

  return {
    ...existing,
    ...incoming,
    active: !!(existing.active || incoming.active),
    recording: !!(existing.recording || incoming.recording),
    transcript: transcript.length ? transcript : existing.transcript || incoming.transcript,
    transcript_tail: transcript_tail.length
      ? transcript_tail
      : existing.transcript_tail || incoming.transcript_tail,
    detected_events: detected_events.length
      ? detected_events.slice(-40)
      : existing.detected_events || incoming.detected_events,
    live_summary:
      (incoming.live_summary || '').trim() || existing.live_summary || incoming.live_summary,
  }
}

function appendTranscriptChunk(
  guardian: GuardianState | undefined,
  text: string,
  at?: string,
  t_sec?: number,
  final = true,
): GuardianState {
  const cleaned = text.trim().replace(/\s+/g, ' ')
  const line: TranscriptLine = {
    text: cleaned,
    at: at || new Date().toISOString(),
    t_sec,
    final,
  }
  const prev = guardian?.transcript || guardian?.transcript_tail || []
  const last = prev[prev.length - 1]
  let transcript: TranscriptLine[]
  if (last && last.final === false) {
    // Replace live partial with newer partial or finalized text
    transcript = [...prev.slice(0, -1), { ...line, at: last.at || line.at }]
  } else if (last && (last.text || '').toLowerCase() === cleaned.toLowerCase() && final) {
    transcript = prev
  } else {
    transcript = [...prev, line]
  }
  transcript = transcript.slice(-80)
  console.log('[transcript] Admin UI updated', { final, text: cleaned, lines: transcript.length })
  return {
    ...guardian,
    active: true,
    recording: guardian?.recording !== false,
    transcript,
    transcript_tail: transcript.slice(-12),
  }
}

function trendOf(c: CaseRow) {
  const t = c.crisis?.trend || (c.crisis as { trend?: string } | undefined)?.trend
  const hist = c.risk_history || []
  if (t === 'increasing') return '⬆ Escalating'
  if (t === 'decreasing') return '⬇ Decreasing'
  if (hist.length >= 2) {
    const a = Number(hist[hist.length - 2]?.score || 0)
    const b = Number(hist[hist.length - 1]?.score || 0)
    if (b - a >= 4) return '⬆ Escalating'
    if (a - b >= 4) return '⬇ Decreasing'
  }
  return '→ Stable'
}

export default function AdminPage() {
  const [keyInput, setKeyInput] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [cases, setCases] = useState<CaseRow[]>([])
  const [selected, setSelected] = useState<CaseRow | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [liveAt, setLiveAt] = useState('')
  const [liveMode, setLiveMode] = useState<'ws' | 'sse' | 'poll'>('poll')
  const [flashIds, setFlashIds] = useState<Record<string, number>>({})

  const applyCases = useCallback((list: CaseRow[]) => {
    const next = sortByPriority(list)
    setCases((prev) => {
      const prevMap = new Map(prev.map((c) => [c.id, c]))
      const flashes: Record<string, number> = {}
      for (const c of next) {
        const old = prevMap.get(c.id)
        if (
          !old ||
          old.risk_score !== c.risk_score ||
          old.updated_at !== c.updated_at ||
          (old.timeline?.length || 0) !== (c.timeline?.length || 0)
        ) {
          flashes[c.id] = Date.now()
        }
      }
      if (Object.keys(flashes).length) {
        setFlashIds((f) => ({ ...f, ...flashes }))
      }
      return next
    })
    setLiveAt(new Date().toLocaleTimeString())
    setSelected((prev) => {
      if (!prev) return prev
      const row = next.find((c) => c.id === prev.id)
      if (!row) return prev
      return {
        ...row,
        guardian: mergeGuardianClient(prev.guardian, row.guardian),
        timeline:
          (row.timeline?.length || 0) >= (prev.timeline?.length || 0)
            ? row.timeline
            : prev.timeline,
      }
    })
  }, [])

  const loadCases = useCallback(
    async (key: string, quiet = false) => {
      if (!quiet) setLoading(true)
      setError('')
      try {
        const res = await fetch(`${API_BASE}/cases`, {
          headers: { 'X-Admin-Key': key },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof data.detail === 'string' ? data.detail : 'Unauthorized')
          setCases([])
          return
        }
        applyCases(data.cases || [])
      } catch {
        setError('Backend unreachable')
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [applyCases],
  )

  const openCase = useCallback(
    async (id: string, key: string) => {
      try {
        const res = await fetch(`${API_BASE}/cases/${id}`, {
          headers: { 'X-Admin-Key': key },
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setSelected((prev) => {
            if (!prev || prev.id !== id) return data as CaseRow
            return {
              ...(data as CaseRow),
              guardian: mergeGuardianClient(prev.guardian, (data as CaseRow).guardian),
            }
          })
        }
      } catch {
        /* keep list row */
      }
    },
    [],
  )

  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_KEY_STORAGE)
    if (saved) {
      setAdminKey(saved)
      void loadCases(saved)
    }
  }, [loadCases])

  // WebSocket-first live dispatch; SSE only as soft fallback (no sticky 5s poll)
  useEffect(() => {
    if (!adminKey) return
    let cancelled = false
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined

    const connectSseFallback = () => {
      if (cancelled || es) return
      es = new EventSource(
        `${API_BASE}/cases/stream?admin_key_q=${encodeURIComponent(adminKey)}`,
      )
      const onCases = (ev: MessageEvent) => {
        if (cancelled) return
        try {
          const data = JSON.parse(ev.data)
          applyCases(data.cases || [])
          setLiveMode('sse')
        } catch {
          /* ignore */
        }
      }
      es.addEventListener('cases', onCases)
      es.onmessage = onCases
      es.addEventListener('live', (ev) => {
        if (cancelled) return
        try {
          const data = JSON.parse((ev as MessageEvent).data) as LiveEvent & {
            case_id?: string
            text?: string
            at?: string
            guardian?: CaseRow['guardian']
          }
          if (data.type === 'transcript_chunk' && data.case_id) {
            const text = String(data.text || '')
            const at = typeof data.at === 'string' ? data.at : undefined
            const t_sec =
              typeof (data as { t_sec?: number }).t_sec === 'number'
                ? (data as { t_sec?: number }).t_sec
                : undefined
            const isFinal = (data as { final?: boolean }).final !== false
            console.log('[transcript] Admin received transcript (SSE)', { text, final: isFinal })
            const fromEvent = data.guardian as CaseRow['guardian'] | undefined
            setCases((prev) =>
              prev.map((c) => {
                if (c.id !== data.case_id) return c
                const withChunk = text
                  ? appendTranscriptChunk(c.guardian, text, at, t_sec, isFinal)
                  : c.guardian
                return {
                  ...c,
                  guardian: mergeGuardianClient(withChunk, fromEvent),
                }
              }),
            )
            setSelected((cur) => {
              if (!cur || cur.id !== data.case_id) return cur
              const withChunk = text
                ? appendTranscriptChunk(cur.guardian, text, at, t_sec, isFinal)
                : cur.guardian
              return {
                ...cur,
                guardian: mergeGuardianClient(withChunk, fromEvent),
              }
            })
            setLiveMode('sse')
            return
          }
          if (data.type === 'detected_event' || data.type === 'guardian_summary') {
            if (data.case_id) {
              setSelected((cur) => {
                if (cur?.id === data.case_id) void openCase(data.case_id!, adminKey)
                return cur
              })
            }
            setLiveMode('sse')
            return
          }
          if (
            data.type === 'case_update' ||
            data.type === 'incident_received' ||
            data.type === 'guardian_activated' ||
            data.type === 'guardian_evidence'
          ) {
            void loadCases(adminKey, true)
            if (data.case_id) {
              setSelected((cur) => {
                if (cur?.id === data.case_id) void openCase(data.case_id!, adminKey)
                return cur
              })
            }
          }
        } catch {
          /* ignore */
        }
      })
      es.onerror = () => {
        es?.close()
        es = null
        if (!cancelled) retry = setTimeout(connectSseFallback, 4000)
      }
    }

    // Initial load then prefer WS (hook below). SSE as backup after short delay if needed.
    void loadCases(adminKey, true)
    retry = setTimeout(() => {
      if (!cancelled) connectSseFallback()
    }, 8000)

    return () => {
      cancelled = true
      es?.close()
      if (retry) clearTimeout(retry)
    }
  }, [adminKey, applyCases, loadCases, openCase])

  const patchFromLive = useCallback(
    (ev: LiveEvent) => {
      if (!adminKey) return
      if (ev.type === 'ping') return

      if ((ev.type === 'incident_received' || ev.type === 'guardian_activated') && ev.case_id) {
        setLiveMode('ws')
        setCases((prev) => {
          if (prev.some((c) => c.id === ev.case_id)) {
            return prev.map((c) =>
              c.id === ev.case_id
                ? {
                    ...c,
                    source:
                      (ev.source as string) ||
                      c.source ||
                      (ev.type === 'guardian_activated' ? 'guardian' : c.source),
                    guardian: mergeGuardianClient(
                      c.guardian,
                      ev.guardian as CaseRow['guardian'],
                    ),
                  }
                : c,
            )
          }
          const row: CaseRow = {
            id: String(ev.case_id),
            public_id: ev.public_id as string | undefined,
            notes: '',
            frequency: 'once',
            severity: 'medium',
            name: (ev.name as string) || 'Anonymous',
            location: (ev.location as string) || 'Approximate',
            lat: ev.lat as number | null | undefined,
            lng: ev.lng as number | null | undefined,
            status: 'open',
            routing: 'admin',
            risk_score: null,
            risk_tier: 'analyzing',
            pipeline_status: 'received',
            created_at: (ev.created_at as string) || new Date().toISOString(),
            source:
              (ev.source as string) ||
              (ev.type === 'guardian_activated' ? 'guardian' : 'report'),
            guardian: mergeGuardianClient(undefined, (ev.guardian as CaseRow['guardian']) || {
              active: ev.type === 'guardian_activated',
              recording: true,
            }),
          }
          return [row, ...prev]
        })
        return
      }

      if (ev.type === 'transcript_chunk' && ev.case_id) {
        const text = String(ev.text || '')
        const at = typeof ev.at === 'string' ? (ev.at as string) : undefined
        const t_sec = typeof ev.t_sec === 'number' ? (ev.t_sec as number) : undefined
        const isFinal = ev.final !== false
        console.log('[transcript] Admin received transcript (WS)', { text, final: isFinal })
        const fromEvent = ev.guardian as CaseRow['guardian'] | undefined
        setCases((prev) =>
          prev.map((c) => {
            if (c.id !== ev.case_id) return c
            const withChunk = text
              ? appendTranscriptChunk(c.guardian, text, at, t_sec, isFinal)
              : c.guardian
            return {
              ...c,
              risk_score: (ev.risk_score as number) ?? c.risk_score,
              risk_tier: (ev.risk_tier as string) || c.risk_tier,
              guardian: mergeGuardianClient(withChunk, fromEvent),
            }
          }),
        )
        setSelected((cur) => {
          if (!cur || cur.id !== ev.case_id) return cur
          const withChunk = text
            ? appendTranscriptChunk(cur.guardian, text, at, t_sec, isFinal)
            : cur.guardian
          return {
            ...cur,
            risk_score: (ev.risk_score as number) ?? cur.risk_score,
            risk_tier: (ev.risk_tier as string) || cur.risk_tier,
            guardian: mergeGuardianClient(withChunk, fromEvent),
          }
        })
        return
      }

      if (ev.type === 'detected_event' && ev.case_id) {
        const event = (ev.event || {}) as {
          kind?: string
          label?: string
          severity?: string
          t_sec?: number
          at?: string
        }
        setSelected((cur) => {
          if (!cur || cur.id !== ev.case_id) return cur
          const prev = cur.guardian?.detected_events || []
          return {
            ...cur,
            guardian: {
              ...cur.guardian,
              active: true,
              detected_events: [...prev, event].slice(-40),
            },
          }
        })
        setCases((prev) =>
          prev.map((c) => {
            if (c.id !== ev.case_id) return c
            const list = c.guardian?.detected_events || []
            return {
              ...c,
              guardian: {
                ...c.guardian,
                active: true,
                detected_events: [...list, event].slice(-40),
              },
            }
          }),
        )
        return
      }

      if (ev.type === 'guardian_summary' && ev.case_id) {
        setSelected((cur) => {
          if (!cur || cur.id !== ev.case_id) return cur
          return {
            ...cur,
            risk_score: (ev.risk_score as number) ?? cur.risk_score,
            risk_tier: (ev.risk_tier as string) || cur.risk_tier,
            ai_recommendation:
              (ev.recommendation as string) || cur.ai_recommendation,
            guardian: {
              ...cur.guardian,
              live_summary: String(ev.live_summary || cur.guardian?.live_summary || ''),
            },
          }
        })
        return
      }

      if (ev.type === 'guardian_evidence' && ev.case_id) {
        void openCase(String(ev.case_id), adminKey)
        return
      }

      if (
        (ev.type === 'case_update' ||
          ev.type === 'risk_complete' ||
          ev.type === 'map_update' ||
          ev.type === 'legal_ready' ||
          ev.type === 'therapy_ready' ||
          ev.type === 'dashboard_sync') &&
        ev.case_id
      ) {
        setLiveMode('ws')
        setCases((prev) =>
          prev.map((c) =>
            c.id === ev.case_id
              ? {
                  ...c,
                  public_id: (ev.public_id as string) || c.public_id,
                  risk_score: (ev.risk_score as number) ?? c.risk_score,
                  risk_tier: (ev.risk_tier as string) ?? c.risk_tier,
                  severity: (ev.severity as string) || c.severity,
                  routing: (ev.routing as CaseRow['routing']) || c.routing,
                  lat: (ev.lat as number) ?? c.lat,
                  lng: (ev.lng as number) ?? c.lng,
                  location: (ev.location as string) || c.location,
                  pipeline: (ev.pipeline as CaseRow['pipeline']) || c.pipeline,
                  pipeline_status:
                    (ev.pipeline_status as string) ||
                    (ev.pipeline as { status?: string } | undefined)?.status ||
                    c.pipeline_status,
                  live_status: (ev.live_status as CaseRow['live_status']) || c.live_status,
                  crisis: (ev.crisis as CaseRow['crisis']) || c.crisis,
                  timeline: (ev.timeline as CaseRow['timeline']) || c.timeline,
                  legal_brief: (ev.legal_brief as CaseRow['legal_brief']) || c.legal_brief,
                  therapy_brief: (ev.therapy_brief as CaseRow['therapy_brief']) || c.therapy_brief,
                  ai_summary: (ev.ai_summary as CaseRow['ai_summary']) || c.ai_summary,
                  next_actions: (ev.next_actions as CaseRow['next_actions']) || c.next_actions,
                  ai_recommendation:
                    (ev.ai_recommendation as string) || c.ai_recommendation,
                  source: (ev.source as string) || c.source,
                  guardian: mergeGuardianClient(
                    c.guardian,
                    ev.guardian as CaseRow['guardian'],
                  ),
                  location_privacy:
                    (ev.location_privacy as CaseRow['location_privacy']) || c.location_privacy,
                  location_updated_at:
                    (ev.location_updated_at as string) || c.location_updated_at,
                  notify_status: (ev.notify_status as string) || c.notify_status,
                  updated_at: (ev.updated_at as string) || c.updated_at,
                }
              : c,
          ),
        )
        setSelected((cur) => {
          if (!cur || cur.id !== ev.case_id) return cur
          return {
            ...cur,
            public_id: (ev.public_id as string) || cur.public_id,
            risk_score: (ev.risk_score as number) ?? cur.risk_score,
            risk_tier: (ev.risk_tier as string) ?? cur.risk_tier,
            severity: (ev.severity as string) || cur.severity,
            routing: (ev.routing as CaseRow['routing']) || cur.routing,
            lat: (ev.lat as number) ?? cur.lat,
            lng: (ev.lng as number) ?? cur.lng,
            location: (ev.location as string) || cur.location,
            location_privacy:
              (ev.location_privacy as CaseRow['location_privacy']) || cur.location_privacy,
            crisis: (ev.crisis as CaseRow['crisis']) || cur.crisis,
            live_status: (ev.live_status as CaseRow['live_status']) || cur.live_status,
            timeline: (ev.timeline as CaseRow['timeline']) || cur.timeline,
            pipeline: (ev.pipeline as CaseRow['pipeline']) || cur.pipeline,
            legal_brief: (ev.legal_brief as CaseRow['legal_brief']) || cur.legal_brief,
            therapy_brief: (ev.therapy_brief as CaseRow['therapy_brief']) || cur.therapy_brief,
            ai_summary: (ev.ai_summary as CaseRow['ai_summary']) || cur.ai_summary,
            next_actions: (ev.next_actions as CaseRow['next_actions']) || cur.next_actions,
            ai_recommendation:
              (ev.ai_recommendation as string) || cur.ai_recommendation,
            notify_status: (ev.notify_status as string) || cur.notify_status,
            source: (ev.source as string) || cur.source,
            guardian: mergeGuardianClient(
              cur.guardian,
              ev.guardian as CaseRow['guardian'],
            ),
          }
        })
      }
    },
    [adminKey, openCase],
  )

  const { connected: wsConnected } = useLiveSocket({
    role: 'admin',
    enabled: !!adminKey,
    onEvent: patchFromLive,
  })

  useEffect(() => {
    if (wsConnected) setLiveMode('ws')
  }, [wsConnected])

  const [guardianWaitTick, setGuardianWaitTick] = useState(0)
  useEffect(() => {
    const isGuardian =
      selected?.source === 'guardian' ||
      !!selected?.guardian?.active ||
      !!selected?.guardian?.recording
    const lines =
      selected?.guardian?.transcript_tail || selected?.guardian?.transcript || []
    if (!isGuardian || (lines?.length || 0) > 0) return
    const t = setInterval(() => setGuardianWaitTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [
    selected?.id,
    selected?.source,
    selected?.guardian?.active,
    selected?.guardian?.recording,
    selected?.guardian?.transcript_tail?.length,
    selected?.guardian?.transcript?.length,
  ])

  // Poll selected Guardian case so transcript lands even if WS/SSE miss a chunk
  useEffect(() => {
    if (!adminKey || !selected?.id) return
    const isGuardian =
      selected.source === 'guardian' ||
      !!selected.guardian?.active ||
      !!selected.guardian?.recording
    if (!isGuardian) return
    const id = selected.id
    const tick = () => {
      void fetch(`${API_BASE}/cases/${id}`, {
        headers: { 'X-Admin-Key': adminKey },
      })
        .then((r) => r.json())
        .then((data: CaseRow) => {
          if (!data?.id) return
          setSelected((cur) => {
            if (!cur || cur.id !== id) return cur
            return {
              ...cur,
              ...data,
              guardian: mergeGuardianClient(cur.guardian, data.guardian),
              timeline:
                (data.timeline?.length || 0) >= (cur.timeline?.length || 0)
                  ? data.timeline
                  : cur.timeline,
            }
          })
          setCases((prev) =>
            prev.map((c) =>
              c.id === id
                ? {
                    ...c,
                    risk_score: data.risk_score ?? c.risk_score,
                    risk_tier: data.risk_tier || c.risk_tier,
                    guardian: mergeGuardianClient(c.guardian, data.guardian),
                    updated_at: data.updated_at || c.updated_at,
                  }
                : c,
            ),
          )
        })
        .catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => clearInterval(timer)
  }, [
    adminKey,
    selected?.id,
    selected?.source,
    selected?.guardian?.active,
    selected?.guardian?.recording,
  ])

  const sorted = useMemo(() => sortByPriority(cases), [cases])

  const stats = useMemo(() => {
    const open = cases.filter((c) => c.status === 'open')
    const today = new Date().toDateString()
    const todayCases = cases.filter((c) => new Date(c.created_at).toDateString() === today)
    const critical = cases.filter(
      (c) =>
        (c.crisis?.tier || c.risk_tier || '').toString().toUpperCase() === 'CRITICAL' ||
        (c.risk_score != null && c.risk_score >= 75),
    )
    const police = cases.filter((c) => c.routing === 'police' && c.status === 'open')
    const ngo = cases.filter((c) => c.routing === 'ngo' && c.status === 'open')
    const resolved = cases.filter((c) => c.status === 'closed')
    const resolvedToday = resolved.filter(
      (c) => new Date(c.updated_at || c.created_at).toDateString() === today,
    )
    const ages = open
      .map((c) => Date.now() - new Date(c.created_at).getTime())
      .filter((n) => !Number.isNaN(n))
    const avgMs = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0
    const avgMin = Math.max(0, Math.round(avgMs / 60000))
    const withScore = cases.filter((c) => typeof c.risk_score === 'number')
    const aiAcc =
      withScore.length > 0
        ? Math.round(
            (withScore.filter((c) => (c.crisis?.confidence || 0.7) >= 0.6).length /
              withScore.length) *
              100,
          )
        : 0
    return {
      live: open.length,
      today: todayCases.length,
      critical: critical.length,
      police: police.length,
      ngo: ngo.length,
      avgResponse: avgMin,
      aiAccuracy: aiAcc,
      resolvedToday: resolvedToday.length,
    }
  }, [cases])

  function unlock(e: FormEvent) {
    e.preventDefault()
    sessionStorage.setItem(ADMIN_KEY_STORAGE, keyInput)
    setAdminKey(keyInput)
    void loadCases(keyInput)
  }

  async function escalate(target: 'ngo' | 'police') {
    if (!selected || !adminKey) return
    const res = await fetch(`${API_BASE}/cases/${selected.id}/escalate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, admin_key: adminKey }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof data.detail === 'string' ? data.detail : 'Escalate failed')
      return
    }
    setSelected(data.case)
    void loadCases(adminKey, true)
  }

  async function closeCase() {
    if (!selected || !adminKey) return
    const res = await fetch(`${API_BASE}/cases/${selected.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_key: adminKey }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof data.detail === 'string' ? data.detail : 'Close failed')
      return
    }
    setSelected(data.case)
    void loadCases(adminKey, true)
  }

  async function reorchestrate() {
    if (!selected || !adminKey) return
    const res = await fetch(`${API_BASE}/orchestrate/${selected.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_key: adminKey }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof data.detail === 'string' ? data.detail : 'Orchestrate failed')
      return
    }
    setSelected(data.case)
    void loadCases(adminKey, true)
  }

  if (!adminKey) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-void px-6 text-ivory">
        <form onSubmit={unlock} className="glass w-full max-w-md rounded-[1.5rem] p-8">
          <p className="font-display text-2xl tracking-[0.14em] text-gold">{SITE.name}</p>
          <h1 className="font-display mt-3 text-3xl">Command access</h1>
          <p className="mt-2 text-sm text-soft/75">Enter admin key for the crisis response desk.</p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="mt-6 w-full rounded-full border border-ivory/15 bg-void/50 px-5 py-3 text-sm outline-none"
            placeholder="Admin key"
          />
          {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
          <button
            type="submit"
            className="mt-5 w-full rounded-full bg-ivory py-3 text-[10px] tracking-[0.24em] text-void uppercase"
          >
            Unlock
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-[100svh] bg-void text-ivory">
      <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.28em] text-gold uppercase">
              Haven · AI Crisis Response Center ·{' '}
              {liveMode === 'ws' ? '🟢 Live WebSocket' : liveMode === 'sse' ? 'SSE' : 'reconnecting'}
              {liveAt ? ` · ${liveAt}` : ''}
            </p>
            <h1 className="font-display mt-2 text-4xl md:text-5xl">SAFRA COMMAND CENTER</h1>
            <p className="mt-2 text-sm text-soft/70">
              Incidents stream in realtime — no refresh required
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="rounded-full border border-ivory/20 px-5 py-2 text-[10px] tracking-[0.2em] uppercase"
            >
              Exit
            </Link>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {[
            { label: 'Live incidents', value: stats.live },
            { label: 'Cases today', value: stats.today },
            { label: 'Critical', value: stats.critical },
            { label: 'Police active', value: stats.police },
            { label: 'NGOs engaged', value: stats.ngo },
            { label: 'Avg age (min)', value: stats.avgResponse },
            { label: 'AI confidence %', value: stats.aiAccuracy },
            { label: 'Resolved today', value: stats.resolvedToday },
          ].map((s) => (
            <motion.div
              key={s.label}
              layout
              className="rounded-2xl border border-ivory/10 bg-void/50 px-3 py-3 backdrop-blur-sm"
            >
              <p className="text-[9px] tracking-[0.16em] text-muted uppercase">{s.label}</p>
              <motion.p
                key={`${s.label}-${s.value}`}
                initial={{ opacity: 0.4, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="font-display mt-1 text-2xl text-ivory"
              >
                {s.value}
              </motion.p>
            </motion.div>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-amber-300">{error}</p>}
        {loading && <p className="mt-4 text-sm text-soft">Loading…</p>}

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="max-h-[520px] overflow-auto rounded-[1.25rem] border border-ivory/10">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-ivory/10 bg-panel/80 text-[10px] tracking-[0.14em] text-muted uppercase">
                <tr>
                  <th className="px-3 py-3">Incident ID</th>
                  <th className="px-3 py-3">Victim Alias</th>
                  <th className="px-3 py-3">Reported</th>
                  <th className="px-3 py-3">Last Activity</th>
                  <th className="px-3 py-3">Age</th>
                  <th className="px-3 py-3">Risk</th>
                  <th className="px-3 py-3">Trend</th>
                  <th className="px-3 py-3">Emotion</th>
                  <th className="px-3 py-3">Assigned</th>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Last Message</th>
                  <th className="px-3 py-3">AI Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const flashing = flashIds[c.id] && Date.now() - flashIds[c.id] < 2500
                  const emotion =
                    c.crisis?.emotion?.primary ||
                    (c.crisis as { emotion?: { primary?: string } } | undefined)?.emotion
                      ?.primary ||
                    '—'
                  return (
                    <motion.tr
                      key={c.id}
                      layout
                      animate={{
                        backgroundColor: flashing
                          ? 'rgba(212,165,116,0.18)'
                          : selected?.id === c.id
                            ? 'rgba(212,165,116,0.1)'
                            : 'rgba(0,0,0,0)',
                      }}
                      onClick={() => {
                        void openCase(c.id, adminKey)
                      }}
                      className="cursor-pointer border-b border-ivory/5 hover:bg-panel/50"
                    >
                      <td className="px-3 py-3 font-mono text-xs text-gold-soft">
                        <span className="block text-[9px] tracking-wider text-muted uppercase">
                          {(c.source === 'guardian' || c.guardian?.active) && (
                            <span className="mr-1 text-rose-300">Guardian Activated · </span>
                          )}
                          {(c.risk_tier === 'analyzing' || c.pipeline_status === 'received') &&
                          c.risk_score == null
                            ? 'NEW INCIDENT'
                            : 'Incident'}
                        </span>
                        {incidentId(c)}
                        {c.guardian?.recording && (
                          <span className="mt-1 block animate-pulse text-[9px] tracking-wider text-rose-300 uppercase">
                            ● Recording
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">{aliasOf(c)}</td>
                      <td className="px-3 py-3 text-soft/80">{timeLabel(c.created_at)}</td>
                      <td className="px-3 py-3 text-soft/80">
                        {timeLabel(c.last_activity_at || c.updated_at || c.created_at)}
                      </td>
                      <td className="px-3 py-3">{ageLabel(c.created_at)}</td>
                      <td className="px-3 py-3">
                        {c.risk_score == null &&
                        (c.risk_tier === 'analyzing' || c.pipeline_status === 'received') ? (
                          <>
                            <span className="text-gold-soft">Analyzing…</span>
                            <span className="mt-0.5 block text-[10px] uppercase text-muted">
                              Pending
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-gold">{c.risk_score ?? '—'}</span>
                            <span className="mt-0.5 block text-[10px] uppercase text-muted">
                              {c.crisis?.tier || c.risk_tier || c.severity}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">{trendOf(c)}</td>
                      <td className="px-3 py-3 capitalize">{emotion}</td>
                      <td className="px-3 py-3 uppercase">
                        {c.risk_score == null ? '—' : c.routing}
                      </td>
                      <td className="max-w-[100px] truncate px-3 py-3 text-xs">
                        {locationLabel(c)}
                      </td>
                      <td className="px-3 py-3 uppercase">{c.status}</td>
                      <td className="max-w-[160px] truncate px-3 py-3 text-xs text-soft/80">
                        {lastMessage(c)}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 text-xs text-gold-soft">
                        {aiRec(c)}
                      </td>
                    </motion.tr>
                  )
                })}
                {!sorted.length && !loading && (
                  <tr>
                    <td colSpan={13} className="px-4 py-8 text-center text-soft/70">
                      No incidents yet — waiting for live reports
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <CasesMap
              cases={sorted.map((c) => ({
                ...c,
                severity: (c.crisis?.tier || c.risk_tier || c.severity || 'medium').toLowerCase(),
                risk_score: c.risk_score,
                location_privacy: c.location_privacy,
              }))}
              selectedId={selected?.id}
              onSelect={(id) => {
                void openCase(id, adminKey)
              }}
            />
          </div>
        </div>

        {selected && (
          <div className="glass mt-8 max-h-[85vh] space-y-6 overflow-y-auto rounded-[1.5rem] p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Case detail</p>
                <h2 className="font-display mt-2 text-3xl">{aliasOf(selected)}</h2>
                <p className="mt-1 text-sm text-soft/70">
                  {incidentId(selected)} · {locationLabel(selected)} ·{' '}
                  {selected.phone || 'No phone'}
                </p>
                <p className="mt-2 text-sm text-gold-soft">
                  Risk {selected.risk_tier || selected.severity}
                  {selected.risk_score != null ? ` (${selected.risk_score}/100)` : ''} · routed{' '}
                  {selected.routing}
                  {selected.notify_status ? ` · ${selected.notify_status}` : ''}
                </p>
                {(selected.source === 'guardian' || selected.guardian?.active) && (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3">
                      <p className="text-[10px] tracking-[0.2em] text-rose-300 uppercase">
                        Guardian Activated
                        {selected.guardian?.recording ? ' · ● Recording' : ''}
                      </p>
                      {selected.guardian?.live_summary ? (
                        <p className="mt-2 text-sm text-soft/90">{selected.guardian.live_summary}</p>
                      ) : null}
                    </div>
                    <LiveTranscriptPanel
                      lines={
                        selected.guardian?.transcript_tail ||
                        selected.guardian?.transcript ||
                        []
                      }
                      recording={!!selected.guardian?.recording}
                      emptyHint={(() => {
                        void guardianWaitTick
                        const started =
                          selected.guardian?.activated_at || selected.created_at
                        const ms = started
                          ? Date.now() - new Date(started).getTime()
                          : 0
                        if (selected.guardian?.recording && ms >= 5000) {
                          return 'No speech received yet — survivor can type a line in Guardian.'
                        }
                        return 'Waiting for speech…'
                      })()}
                    />
                    <DetectedEvents
                      events={selected.guardian?.detected_events || []}
                      confidence={
                        typeof selected.crisis?.confidence === 'number'
                          ? selected.crisis.confidence
                          : 0.9
                      }
                      recommendation={
                        selected.ai_recommendation || selected.crisis?.recommendation
                      }
                      durationSec={
                        selected.guardian?.recording_meta?.duration_sec ??
                        (selected.guardian?.activated_at
                          ? (Date.now() -
                              new Date(selected.guardian.activated_at).getTime()) /
                            1000
                          : null)
                      }
                    />
                    <EvidencePlayer
                      caseId={selected.id}
                      adminKey={adminKey}
                      recording={!!selected.guardian?.recording}
                      evidence={
                        (selected.evidence || []).find(
                          (e) =>
                            e.id === selected.guardian?.recording_meta?.evidence_id ||
                            e.stored_as === selected.guardian?.recording_meta?.evidence_id,
                        ) ||
                        (selected.evidence || []).filter((e) => !e.pending).slice(-1)[0] ||
                        (selected.evidence || []).slice(-1)[0] ||
                        (selected.guardian?.recording_meta
                          ? {
                              id: selected.guardian.recording_meta.evidence_id,
                              sha256: selected.guardian.recording_meta.sha256,
                              bytes: selected.guardian.recording_meta.bytes,
                              duration_sec: selected.guardian.recording_meta.duration_sec,
                              encrypted_at_rest:
                                selected.guardian.recording_meta.encrypted_at_rest,
                            }
                          : null)
                      }
                    />
                  </div>
                )}
                <div className="mt-4 max-w-md rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[10px] tracking-[0.2em] text-gold uppercase">Incident location</p>
                  {typeof selected.lat === 'number' && typeof selected.lng === 'number' ? (
                    <>
                      <p className="mt-2 text-sm text-ivory">
                        {selected.location_privacy?.label ||
                          selected.location_privacy?.city ||
                          selected.location ||
                          'Approximate area'}
                        {selected.location_privacy?.state
                          ? `, ${selected.location_privacy.state}`
                          : ''}
                      </p>
                      {!selected.location_privacy?.hide_exact && (
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                        </p>
                      )}
                      {selected.location_privacy?.hide_exact && (
                        <p className="mt-1 text-[10px] text-muted">Exact GPS hidden by survivor</p>
                      )}
                      <dl className="mt-3 grid gap-2 text-xs text-soft/85 sm:grid-cols-2">
                        <div>
                          <dt className="text-[10px] tracking-wider text-muted uppercase">GPS accuracy</dt>
                          <dd className="mt-0.5 capitalize">
                            {selected.location_privacy?.accuracy_band || 'unknown'}
                            {selected.location_privacy?.accuracy_m != null
                              ? ` (±${Math.round(selected.location_privacy.accuracy_m)}m)`
                              : ''}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] tracking-wider text-muted uppercase">Last updated</dt>
                          <dd className="mt-0.5">
                            {selected.location_updated_at
                              ? new Date(selected.location_updated_at).toLocaleString()
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] tracking-wider text-muted uppercase">
                            Live tracking
                          </dt>
                          <dd className="mt-0.5">
                            {selected.location_privacy?.live_tracking ? (
                              <span className="text-gold-soft">Active · pulsing</span>
                            ) : (
                              'Off'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] tracking-wider text-muted uppercase">
                            ETA · nearest responder
                          </dt>
                          <dd className="mt-0.5">
                            {selected.location_privacy?.nearest_eta_min != null
                              ? `~${selected.location_privacy.nearest_eta_min} min`
                              : selected.routing === 'police'
                                ? '~12 min (est.)'
                                : selected.routing === 'ngo'
                                  ? '~25 min (est.)'
                                  : 'Pending assignment'}
                          </dd>
                        </div>
                      </dl>
                      <a
                        className="mt-3 inline-block text-[10px] tracking-[0.16em] text-gold-soft uppercase underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=16/${selected.lat}/${selected.lng}`}
                      >
                        Open map
                      </a>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-muted">
                      Location not shared — report still active
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[10px] tracking-[0.2em] text-muted uppercase"
              >
                Close panel
              </button>
            </div>

            <p className="whitespace-pre-wrap text-sm text-soft/90">{selected.notes}</p>

            {selected.legal_brief?.answer && (
              <div className="max-h-80 overflow-y-auto rounded-[1.35rem] border border-ivory/10 bg-void/40 p-5">
                <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Legal brief</p>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-soft/90">
                  {selected.legal_brief.answer}
                </pre>
                {!!selected.legal_brief.sources?.length && (
                  <ul className="mt-4 max-h-32 space-y-1 overflow-y-auto text-xs text-muted">
                    {(selected.legal_brief.sources as { title?: string; source?: string }[]).map(
                      (s, i) => (
                        <li key={i}>• {s.title || s.source || 'Source'}</li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <RiskPanel
                score={selected.risk_score ?? 0}
                tier={(selected.crisis?.tier || selected.risk_tier || selected.severity || '').toUpperCase()}
                confidence={selected.crisis?.confidence}
                reasons={selected.crisis?.reasons}
                scores={selected.crisis?.scores}
                recommendation={selected.ai_recommendation || selected.crisis?.recommendation}
                trend={
                  selected.crisis?.trend === 'increasing' ||
                  trendOf(selected).includes('Escalat')
                    ? 'increasing'
                    : selected.crisis?.trend === 'decreasing'
                      ? 'decreasing'
                      : selected.crisis?.trend
                }
                delta={selected.crisis?.delta}
                history={selected.risk_history}
              />
              <IncidentTimeline items={selected.timeline} />
            </div>

            <VictimLiveBoard
              status={selected.live_status as never}
              summary={selected.ai_summary}
              nextActions={selected.next_actions}
            />

            <CrisisPipeline
              riskIndex={selected.risk_score ?? undefined}
              tier={(selected.crisis?.tier || selected.risk_tier || '').toString().toUpperCase()}
              stages={(selected.pipeline?.stages || []).map((s, i, arr) => ({
                id: s.stage,
                label: s.stage.replace(/_/g, ' '),
                done: true,
                active: i === arr.length - 1,
              }))}
            />

            {!!selected.evidence?.length && (
              <ul className="space-y-1 text-sm text-soft/70">
                {selected.evidence.map((ev) => (
                  <li key={ev.stored_as}>📎 {ev.filename}</li>
                ))}
              </ul>
            )}

            {selected.escalation_contacts?.primary && (
              <p className="rounded-2xl border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold-soft">
                Contact: {selected.escalation_contacts.primary}
              </p>
            )}

            <AgentTimeline plan={selected.agent_plan} log={selected.agent_log} />

            <div className="grid gap-4 lg:grid-cols-2">
              <AiChatPanel
                caseId={selected.id}
                kind="legal"
                auth={{ adminKey }}
              />
              <AiChatPanel
                caseId={selected.id}
                kind="therapy"
                auth={{ adminKey }}
              />
            </div>

            <SecureMessageForm
              caseId={selected.id}
              adminKey={adminKey}
              onSent={() => void openCase(selected.id, adminKey)}
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void reorchestrate()}
                className="rounded-full border border-gold/40 px-5 py-2.5 text-[10px] tracking-[0.2em] text-gold uppercase"
              >
                Re-orchestrate
              </button>
              <button
                type="button"
                onClick={() => escalate('ngo')}
                className="rounded-full border border-amber-400/40 px-5 py-2.5 text-[10px] tracking-[0.2em] text-amber-100 uppercase"
              >
                Escalate to NGO
              </button>
              <button
                type="button"
                onClick={() => escalate('police')}
                className="rounded-full border border-red-400/40 px-5 py-2.5 text-[10px] tracking-[0.2em] text-red-200 uppercase"
              >
                Escalate to Police
              </button>
              <button
                type="button"
                onClick={closeCase}
                className="rounded-full bg-ivory px-5 py-2.5 text-[10px] tracking-[0.2em] text-void uppercase"
              >
                Close issue
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
