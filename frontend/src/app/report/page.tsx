'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  API_BASE,
  PASSPORT_TOKEN_KEY,
  SITE,
} from '@/lib/constants'
import { AgentChat } from '@/components/agents/AgentChat'
import dynamic from 'next/dynamic'

const LocationPicker = dynamic(
  () =>
    import('@/components/report/LocationPickerMap').then((m) => m.LocationPickerMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[220px] items-center justify-center rounded-2xl border border-ivory/10 text-xs text-muted">
        Loading map…
      </div>
    ),
  },
)

type Orchestration = {
  case_id?: string
  risk_score?: number
  risk_tier?: string
  routing?: string
  legal_tip?: string
  therapy_tip?: string
  notify_status?: string
  secure_token?: string
}

type SubmitResult = {
  routing: 'admin' | 'ngo' | 'police'
  message: string
  caseId: string
  orchestration: Orchestration
  secureToken?: string
}

type GpsState = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  status: 'pending' | 'ok' | 'denied' | 'unavailable' | 'pinned'
}

export default function ReportPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [passportToken, setPassportToken] = useState('')
  const [notes, setNotes] = useState('')
  const [frequency, setFrequency] = useState('once')
  const [severity, setSeverity] = useState('medium')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [gps, setGps] = useState<GpsState>({
    lat: null,
    lng: null,
    accuracy: null,
    status: 'pending',
  })

  useEffect(() => {
    const token = sessionStorage.getItem(PASSPORT_TOKEN_KEY)
    if (!token) {
      router.replace('/')
      return
    }
    setPassportToken(token)
    setReady(true)

    if (!navigator.geolocation) {
      setGps((g) => ({ ...g, status: 'unavailable' }))
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGps((g) => {
          if (g.status === 'pinned') return g
          return {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            status: 'ok',
          }
        })
      },
      () => {
        setGps((g) => {
          if (g.status === 'pinned' || g.lat != null) {
            return g.status === 'pinned' ? g : { ...g, status: 'ok' }
          }
          return { ...g, status: 'denied' }
        })
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [router])

  function retryGps() {
    if (!navigator.geolocation) {
      setGps((g) => ({ ...g, status: 'unavailable' }))
      return
    }
    setGps((g) => ({ ...g, status: 'pending' }))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          status: 'ok',
        })
      },
      () => {
        setGps((g) => ({
          ...g,
          status: g.lat != null ? (g.status === 'pinned' ? 'pinned' : 'ok') : 'denied',
        }))
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const token = sessionStorage.getItem(PASSPORT_TOKEN_KEY)
    if (!token) {
      router.replace('/')
      return
    }
    setLoading(true)
    try {
      const body = new FormData()
      body.append('notes', notes)
      body.append('frequency', frequency)
      body.append('severity', severity)
      body.append('token', token)
      if (name.trim()) body.append('name', name.trim())
      if (phone.trim()) body.append('phone', phone.trim())
      if (location.trim()) body.append('location', location.trim())
      if (gps.lat != null && gps.lng != null) {
        body.append('lat', String(gps.lat))
        body.append('lng', String(gps.lng))
      }
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
        return
      }
      const orch: Orchestration = data.orchestration || {}
      const caseId = orch.case_id || data.case?.id || ''
      const secureToken = data.secure_token || orch.secure_token
      if (secureToken) {
        sessionStorage.setItem('safra_secure_token', secureToken)
      }
      if (caseId) {
        sessionStorage.setItem('safra_case_id', caseId)
      }
      setResult({
        routing: data.routing || data.case?.routing || 'admin',
        message: data.message || 'Order received',
        caseId,
        orchestration: orch,
        secureToken,
      })
    } catch {
      setError('Service unavailable. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-void text-soft">
        Checking session…
      </main>
    )
  }

  const gpsLabel =
    (gps.status === 'ok' || gps.status === 'pinned') && gps.lat != null
      ? gps.status === 'pinned'
        ? 'Delivery pin set on map'
        : `Delivery area confirmed (±${Math.round(gps.accuracy || 0)}m)`
      : gps.status === 'pending'
        ? 'Confirming delivery area…'
        : 'Location blocked — tap the map below to set your delivery area'

  const showPicker = gps.status === 'denied' || gps.status === 'unavailable' || gps.status === 'pinned'

  return (
    <main className="min-h-[100svh] bg-void text-ivory">
      <div className="mx-auto max-w-2xl px-6 py-12 md:px-10">
        <p className="font-display text-2xl tracking-[0.14em] text-gold">{SITE.name}</p>
        <h1 className="font-display mt-4 text-4xl md:text-5xl">Order notes</h1>
        <p className="mt-3 max-w-lg text-sm text-soft/80">
          Add details for your delivery. You can leave contact fields blank if you prefer.
        </p>

        {result ? (
          <div className="mt-10 space-y-6">
            <div className="glass rounded-[1.75rem] p-8">
              <p className="text-[10px] tracking-[0.28em] text-gold uppercase">Confirmed</p>
              <h2 className="font-display mt-3 text-3xl">{result.message}</h2>
              <p className="mt-4 text-sm text-soft/85">
                {result.routing === 'police' &&
                  'Your order has been prioritized for immediate local assistance.'}
                {result.routing === 'ngo' &&
                  'Your order has been routed to a support partner for follow-up.'}
                {result.routing === 'admin' &&
                  'Your order is with our support desk. Help is on the way.'}
              </p>
              <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-2xl border border-ivory/10 px-4 py-3">
                  <p className="text-[10px] tracking-[0.18em] text-muted uppercase">Risk</p>
                  <p className="mt-1 uppercase text-gold">
                    {result.orchestration.risk_tier || '—'}{' '}
                    {result.orchestration.risk_score != null
                      ? `(${result.orchestration.risk_score})`
                      : ''}
                  </p>
                </div>
                <div className="rounded-2xl border border-ivory/10 px-4 py-3">
                  <p className="text-[10px] tracking-[0.18em] text-muted uppercase">Routed</p>
                  <p className="mt-1 uppercase">{result.routing}</p>
                </div>
                <div className="rounded-2xl border border-ivory/10 px-4 py-3">
                  <p className="text-[10px] tracking-[0.18em] text-muted uppercase">Notify</p>
                  <p className="mt-1 text-xs">
                    {result.orchestration.notify_status || 'queued'}
                  </p>
                </div>
              </div>
              {result.orchestration.legal_tip && (
                <p className="mt-5 whitespace-pre-wrap rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3 text-sm text-soft/90">
                  {result.orchestration.legal_tip}
                </p>
              )}
              {result.orchestration.therapy_tip && (
                <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-ivory/10 px-4 py-3 text-sm text-soft/85">
                  {result.orchestration.therapy_tip}
                </p>
              )}
              {result.secureToken && (
                <p className="mt-5 text-sm text-gold-soft">
                  Secure channel:{' '}
                  <Link
                    className="underline"
                    href={`/secure/${result.secureToken}`}
                  >
                    open private messages
                  </Link>
                </p>
              )}
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/"
                  className="rounded-full bg-ivory px-6 py-3 text-[10px] tracking-[0.22em] text-void uppercase"
                >
                  Back to menu
                </Link>
                {result.secureToken && (
                  <Link
                    href={`/secure/${result.secureToken}`}
                    className="rounded-full border border-ivory/20 px-6 py-3 text-[10px] tracking-[0.22em] text-soft uppercase"
                  >
                    Secure channel
                  </Link>
                )}
              </div>
            </div>

            {result.caseId && (
              <div className="grid gap-4 md:grid-cols-2">
                <AgentChat
                  caseId={result.caseId}
                  kind="legal"
                  auth={{ token: passportToken || result.secureToken }}
                />
                <AgentChat
                  caseId={result.caseId}
                  kind="therapy"
                  auth={{ token: passportToken || result.secureToken }}
                />
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="glass mt-10 space-y-5 rounded-[1.75rem] p-7 md:p-9">
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                gps.status === 'ok' || gps.status === 'pinned'
                  ? 'border-gold/30 bg-gold/10 text-gold-soft'
                  : 'border-ivory/10 bg-void/40 text-soft/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{gpsLabel}</span>
                {gps.status !== 'ok' && (
                  <button
                    type="button"
                    onClick={retryGps}
                    className="rounded-full border border-ivory/20 px-3 py-1 text-[10px] tracking-[0.16em] uppercase"
                  >
                    Retry GPS
                  </button>
                )}
              </div>
            </div>

            {(showPicker || gps.status === 'pending') && gps.status !== 'ok' && (
              <LocationPicker
                lat={gps.lat}
                lng={gps.lng}
                onPick={(lat, lng) => {
                  setGps({
                    lat,
                    lng,
                    accuracy: null,
                    status: 'pinned',
                  })
                }}
              />
            )}

            <label className="block space-y-2">
              <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Notes</span>
              <textarea
                required
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder="Describe what happened…"
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
                  <option value="repeated">Repeated</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Priority</span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block space-y-2 sm:col-span-1">
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
              <label className="block space-y-2">
                <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Area label</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
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
              disabled={loading || !notes.trim()}
              className="w-full rounded-full bg-ivory py-4 text-[10px] tracking-[0.28em] text-void uppercase disabled:opacity-40"
            >
              {loading ? 'Sending…' : 'Place order'}
            </button>

            <p className="text-center text-[10px] tracking-[0.18em] text-muted uppercase">
              Legal &amp; therapy agents unlock after you place the order
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
