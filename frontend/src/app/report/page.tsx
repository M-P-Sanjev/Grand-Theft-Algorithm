'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  API_BASE,
  PASSPORT_TOKEN_KEY,
  SITE,
} from '@/lib/constants'
import { AiChatPanel } from '@/components/agents/AiChatPanel'
import { VictimLiveBoard } from '@/components/crisis/VictimLiveBoard'
import { CrisisPipeline } from '@/components/crisis/CrisisPipeline'
import { useLiveSocket, type LiveEvent } from '@/hooks/useLiveSocket'
import {
  LocationExperience,
  appendLocationToForm,
  type LocationPayload,
} from '@/components/report/LocationExperience'

type Orchestration = {
  case_id?: string
  public_id?: string
  risk_score?: number
  risk_tier?: string
  routing?: string
  legal_tip?: string
  therapy_tip?: string
  notify_status?: string
  secure_token?: string
  ai_summary?: {
    headline?: string
    victim_profile?: string[]
    recommended?: string[]
    plain_status?: string
  }
  next_actions?: { id: string; label: string; plain: string }[]
  live_status?: {
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
  pipeline?: { stages?: { stage: string; at?: string; label?: string }[]; status?: string }
  crisis?: { tier?: string; reasons?: string[]; scores?: Record<string, number> }
  legal_brief?: { answer?: string; sources?: unknown[] }
  therapy_brief?: { answer?: string }
}

type SubmitResult = {
  routing: 'admin' | 'ngo' | 'police'
  message: string
  caseId: string
  publicId?: string
  orchestration: Orchestration
  secureToken?: string
}

const DEFAULT_STAGES = [
  { id: 'received', label: '✓ Incident received', done: true, active: false },
  { id: 'analyzing', label: 'Analysing emotions…', done: false, active: true },
  { id: 'violence', label: 'Assessing danger…', done: false, active: false },
  { id: 'legal_rag', label: 'Finding legal protections…', done: false, active: false },
  { id: 'therapy_rag', label: 'Preparing emotional support…', done: false, active: false },
  { id: 'resources', label: 'Finding nearby help…', done: false, active: false },
  { id: 'complete', label: 'Dashboard updated · responder notified', done: false, active: false },
]

export default function ReportPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [passportToken, setPassportToken] = useState('')
  const [notes, setNotes] = useState('')
  const [frequency, setFrequency] = useState('once')
  const [severity, setSeverity] = useState('medium')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [loc, setLoc] = useState<LocationPayload | null>(null)
  const [liveStages, setLiveStages] = useState(DEFAULT_STAGES)
  const [orch, setOrch] = useState<Orchestration | null>(null)

  useEffect(() => {
    const token = sessionStorage.getItem(PASSPORT_TOKEN_KEY)
    if (!token) {
      router.replace('/')
      return
    }
    setPassportToken(token)
    setReady(true)
  }, [router])

  const applyLiveEvent = useCallback((ev: LiveEvent, caseId: string) => {
    if (ev.case_id && ev.case_id !== caseId) return

    if (ev.type === 'pipeline_stage' && ev.stage) {
      const label =
        (typeof ev.label === 'string' && ev.label) ||
        (typeof ev.detail === 'object' && ev.detail && 'label' in ev.detail
          ? String((ev.detail as { label?: string }).label)
          : null) ||
        ev.stage.replace(/_/g, ' ')
      setLiveStages((prev) => {
        const order = ['received', 'analyzing', 'emotion_detected', 'risk_assessing', 'risk_complete', 'legal_rag', 'legal_ready', 'therapy_rag', 'therapy_ready', 'resources', 'dashboard_sync', 'notify', 'admin_notified', 'map', 'map_update', 'complete']
        const mapped: Record<string, string> = {
          received: 'received',
          analyzing: 'analyzing',
          emotion_detected: 'analyzing',
          violence: 'violence',
          violence_detected: 'violence',
          risk_assessing: 'violence',
          risk_complete: 'violence',
          legal_rag: 'legal_rag',
          legal_ready: 'legal_rag',
          therapy_rag: 'therapy_rag',
          therapy_ready: 'therapy_rag',
          resources: 'resources',
          dashboard_sync: 'complete',
          notify: 'complete',
          admin_notified: 'complete',
          map: 'complete',
          map_update: 'complete',
          complete: 'complete',
        }
        const uiId = mapped[ev.stage!] || 'analyzing'
        return prev.map((s) => {
          const si = order.indexOf(s.id === 'analyzing' ? 'analyzing' : s.id)
          const ei = order.indexOf(ev.stage!)
          if (s.id === uiId) {
            return { ...s, label: s.id === 'received' ? s.label : label, done: true, active: ev.stage !== 'complete' }
          }
          if (s.id === 'complete' && ev.stage === 'complete') {
            return { ...s, done: true, active: false }
          }
          if (si >= 0 && ei >= 0 && si < ei) {
            return { ...s, done: true, active: false }
          }
          return { ...s, active: false }
        })
      })
    }

    if (
      ev.type === 'case_update' ||
      ev.type === 'risk_complete' ||
      ev.type === 'legal_ready' ||
      ev.type === 'therapy_ready' ||
      ev.type === 'dashboard_sync'
    ) {
      setOrch((prev) => ({
        ...(prev || {}),
        case_id: caseId,
        risk_score: (ev.risk_score as number) ?? prev?.risk_score,
        risk_tier: (ev.risk_tier as string) ?? prev?.risk_tier,
        routing: (ev.routing as string) ?? prev?.routing,
        live_status: (ev.live_status as Orchestration['live_status']) || prev?.live_status,
        ai_summary: (ev.ai_summary as Orchestration['ai_summary']) || prev?.ai_summary,
        next_actions: (ev.next_actions as Orchestration['next_actions']) || prev?.next_actions,
        crisis: (ev.crisis as Orchestration['crisis']) || prev?.crisis,
        pipeline: (ev.pipeline as Orchestration['pipeline']) || prev?.pipeline,
        legal_brief: (ev.legal_brief as Orchestration['legal_brief']) || prev?.legal_brief,
        therapy_brief: (ev.therapy_brief as Orchestration['therapy_brief']) || prev?.therapy_brief,
      }))
      setResult((prev) =>
        prev
          ? {
              ...prev,
              routing: ((ev.routing as SubmitResult['routing']) || prev.routing),
              orchestration: {
                ...prev.orchestration,
                risk_score: (ev.risk_score as number) ?? prev.orchestration.risk_score,
                risk_tier: (ev.risk_tier as string) ?? prev.orchestration.risk_tier,
                routing: (ev.routing as string) ?? prev.orchestration.routing,
                live_status:
                  (ev.live_status as Orchestration['live_status']) ||
                  prev.orchestration.live_status,
                crisis: (ev.crisis as Orchestration['crisis']) || prev.orchestration.crisis,
                legal_brief:
                  (ev.legal_brief as Orchestration['legal_brief']) ||
                  prev.orchestration.legal_brief,
                therapy_brief:
                  (ev.therapy_brief as Orchestration['therapy_brief']) ||
                  prev.orchestration.therapy_brief,
              },
            }
          : prev,
      )
    }

    if (ev.type === 'secure_token' && typeof ev.secure_token === 'string') {
      sessionStorage.setItem('safra_secure_token', ev.secure_token)
      setResult((prev) => (prev ? { ...prev, secureToken: ev.secure_token as string } : prev))
    }
  }, [])

  useLiveSocket({
    caseId: result?.caseId,
    role: 'victim',
    enabled: !!result?.caseId,
    onEvent: (ev) => {
      if (result?.caseId) applyLiveEvent(ev, result.caseId)
    },
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const token = sessionStorage.getItem(PASSPORT_TOKEN_KEY)
    if (!token) {
      router.replace('/')
      return
    }
    setSending(true)
    // Optimistic dispatch UI immediately
    setLiveStages(DEFAULT_STAGES)
    try {
      const body = new FormData()
      body.append('notes', notes)
      body.append('frequency', frequency)
      body.append('severity', severity)
      body.append('token', token)
      if (name.trim()) body.append('name', name.trim())
      if (phone.trim()) body.append('phone', phone.trim())
      appendLocationToForm(body, loc)
      if (files) {
        Array.from(files).forEach((f) => body.append('files', f))
      }

      const res = await fetch(`${API_BASE}/cases`, {
        method: 'POST',
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Could not submit')
        setSending(false)
        return
      }
      const orchData: Orchestration = data.orchestration || {}
      const caseId = data.case_id || orchData.case_id || data.case?.id || ''
      const publicId = data.public_id || orchData.public_id || data.case?.public_id
      if (caseId) sessionStorage.setItem('safra_case_id', caseId)
      setOrch(orchData)
      setResult({
        routing: data.routing || data.case?.routing || 'admin',
        message: data.message || 'Your request has been received.',
        caseId,
        publicId,
        orchestration: orchData,
      })
    } catch {
      setError('Service unavailable. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const companionsReady = useMemo(() => {
    return !!(orch?.legal_brief || orch?.therapy_brief || orch?.risk_score != null)
  }, [orch])

  if (!ready) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-void text-soft">
        Checking session…
      </main>
    )
  }

  return (
    <main className="min-h-[100svh] bg-void text-ivory">
      <div className="mx-auto max-w-2xl px-6 py-12 md:px-10">
        <p className="font-display text-2xl tracking-[0.14em] text-gold">{SITE.name}</p>
        <h1 className="font-display mt-4 text-4xl md:text-5xl">What happened?</h1>
        <p className="mt-3 max-w-lg text-sm text-soft/80">
          Tell us in your own words. You can skip your name or phone if that feels safer.
        </p>

        {result ? (
          <div className="mt-10 space-y-6">
            <div className="glass rounded-[1.75rem] p-8">
              <p className="text-[10px] tracking-[0.28em] text-gold uppercase">Dispatch</p>
              <h2 className="font-display mt-3 text-3xl">✓ Your request has been received.</h2>
              <p className="mt-2 text-sm text-gold-soft">✓ We&apos;re analysing it now.</p>
              {result.publicId && (
                <p className="mt-3 text-xs tracking-[0.16em] text-muted uppercase">
                  Incident {result.publicId}
                </p>
              )}
            </div>

            <CrisisPipeline
              title="Live status"
              riskIndex={orch?.risk_score ?? result.orchestration.risk_score}
              tier={(
                orch?.crisis?.tier ||
                orch?.risk_tier ||
                result.orchestration.risk_tier ||
                'analyzing'
              ).toUpperCase()}
              stages={liveStages}
            />

            {(orch?.live_status || orch?.ai_summary) && (
              <VictimLiveBoard
                status={orch?.live_status}
                summary={orch?.ai_summary}
                nextActions={orch?.next_actions}
              />
            )}

            {result.secureToken && (
              <p className="text-sm text-gold-soft">
                Private messages:{' '}
                <Link className="underline" href={`/secure/${result.secureToken}`}>
                  open secure channel
                </Link>
              </p>
            )}

            {result.caseId && companionsReady && (
              <ReportCompanions
                caseId={result.caseId}
                token={passportToken || result.secureToken || ''}
                initial={orch || result.orchestration}
              />
            )}

            {result.caseId &&
              ((orch?.crisis?.tier || orch?.risk_tier || '').toUpperCase() === 'CRITICAL' ||
                loc?.liveSharing) && (
                <LocationExperience
                  criticalHint
                  caseId={result.caseId}
                  authToken={passportToken || result.secureToken || ''}
                  autoStartLive={!!loc?.liveSharing}
                  onChange={() => undefined}
                />
              )}

            <Link
              href="/"
              className="inline-flex rounded-full bg-ivory px-6 py-3 text-[10px] tracking-[0.22em] text-void uppercase"
            >
              Back to safety
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="glass mt-10 space-y-5 rounded-[1.75rem] p-7 md:p-9">
            <LocationExperience
              criticalHint={severity === 'critical' || severity === 'high'}
              onChange={setLoc}
            />

            <label className="block space-y-2">
              <span className="text-[10px] tracking-[0.22em] text-muted uppercase">What happened?</span>
              <textarea
                required
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder="Tell us in your own words…"
                className="w-full rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none placeholder:text-muted focus:border-gold/35"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Frequency</span>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none"
                >
                  <option value="once">Once</option>
                  <option value="repeated">More than once</option>
                  <option value="ongoing">Still happening</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] tracking-[0.22em] text-muted uppercase">
                  How unsafe do you feel?
                </span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none"
                >
                  <option value="low">Somewhat safe</option>
                  <option value="medium">Worried</option>
                  <option value="high">In danger</option>
                  <option value="critical">Need help urgently</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none"
                  placeholder="Optional"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Phone</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none"
                  placeholder="Optional"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-[10px] tracking-[0.22em] text-muted uppercase">
                Evidence (photos / files)
              </span>
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => setFiles(e.target.files)}
                className="block w-full text-sm text-soft file:mr-4 file:rounded-full file:border-0 file:bg-ivory/90 file:px-4 file:py-2 file:text-[10px] file:tracking-[0.18em] file:text-void file:uppercase"
              />
            </label>

            {error && <p className="text-sm text-amber-300/90">{error}</p>}

            <button
              type="submit"
              disabled={sending || !notes.trim()}
              className="w-full rounded-full bg-ivory py-4 text-[10px] tracking-[0.28em] text-void uppercase disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'SEND'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

function ReportCompanions({
  caseId,
  token,
  initial,
}: {
  caseId: string
  token: string
  initial: Orchestration
}) {
  const [orch, setOrch] = useState(initial)

  useEffect(() => {
    setOrch(initial)
  }, [initial])

  return (
    <div className="space-y-4">
      <div className="grid max-h-[720px] gap-4 lg:grid-cols-2 lg:overflow-hidden">
        <div className="min-h-0 max-h-[720px] overflow-hidden">
          <AiChatPanel
            caseId={caseId}
            kind="therapy"
            auth={{ token }}
            onCrisisUpdate={(p) => {
              setOrch((prev) => ({
                ...prev,
                risk_score: p.risk_index ?? prev.risk_score,
                risk_tier: (p.tier || prev.risk_tier || '').toLowerCase(),
                live_status: (p.live_status as Orchestration['live_status']) || prev.live_status,
                ai_summary: (p.ai_summary as Orchestration['ai_summary']) || prev.ai_summary,
                next_actions:
                  (p.next_actions as Orchestration['next_actions']) || prev.next_actions,
              }))
            }}
          />
        </div>
        <div className="min-h-0 max-h-[720px] overflow-hidden">
          <AiChatPanel
            caseId={caseId}
            kind="legal"
            auth={{ token }}
            onCrisisUpdate={(p) => {
              setOrch((prev) => ({
                ...prev,
                risk_score: p.risk_index ?? prev.risk_score,
                risk_tier: (p.tier || prev.risk_tier || '').toLowerCase(),
              }))
            }}
          />
        </div>
      </div>
    </div>
  )
}
