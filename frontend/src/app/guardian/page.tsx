'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { API_BASE, PASSPORT_TOKEN_KEY, SITE } from '@/lib/constants'
import { useWakeWord } from '@/hooks/useWakeWord'
import { GuardianOverlay } from '@/components/guardian/GuardianOverlay'
import {
  STEALTH_DISGUISE_OPTIONS,
  type StealthDisguise,
} from '@/components/guardian/StealthShell'

const STORAGE_KEY = 'safra_guardian_prefs_v1'

type Prefs = {
  enabled: boolean
  stealth: boolean
  stealthDisguise: StealthDisguise
  camera: boolean
  autoSendCritical: boolean
  contactName: string
  contactPhone: string
}

const DEFAULT_PREFS: Prefs = {
  enabled: false,
  stealth: false,
  stealthDisguise: 'shopping',
  camera: false,
  autoSendCritical: false,
  contactName: '',
  contactPhone: '',
}

export default function GuardianPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState('')
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<{ caseId: string; publicId?: string } | null>(null)

  useEffect(() => {
    const t = sessionStorage.getItem(PASSPORT_TOKEN_KEY)
    if (!t) {
      router.replace('/')
      return
    }
    setToken(t)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) })
    } catch {
      /* ignore */
    }
    setReady(true)
  }, [router])

  function savePrefs(next: Prefs) {
    setPrefs(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  async function activate(phrase?: string) {
    if (activating || session) return
    setActivating(true)
    setError('')
    try {
      let lat: number | undefined
      let lng: number | undefined
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 5000,
            maximumAge: 60000,
          }),
        )
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch {
        /* optional */
      }

      const res = await fetch(`${API_BASE}/guardian/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          lat,
          lng,
          stealth: prefs.stealth,
          recording: true,
          location: phrase || 'Guardian Mode',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Could not activate')
        return
      }
      setSession({ caseId: data.case_id, publicId: data.public_id })
      sessionStorage.setItem('safra_case_id', data.case_id)
    } catch {
      setError('Service unavailable')
    } finally {
      setActivating(false)
    }
  }

  const { listening, supported } = useWakeWord({
    enabled: prefs.enabled && !!token && !session,
    onWake: (phrase) => void activate(phrase),
  })

  if (!ready) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-void text-soft">
        Checking session…
      </main>
    )
  }

  return (
    <main className="min-h-[100svh] bg-void text-ivory">
      <div className="mx-auto max-w-xl px-6 py-12">
        <p className="font-display text-2xl tracking-[0.14em] text-gold">{SITE.name}</p>
        <h1 className="font-display mt-4 text-4xl">Guardian Mode</h1>
        <p className="mt-3 text-sm text-soft/80">
          Emergency activation — not a normal voice assistant. Opt in first. Wake-word listening
          runs locally in this browser tab.
        </p>

        <div className="glass mt-8 space-y-5 rounded-[1.75rem] p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ivory">Enable Guardian Mode</p>
              <p className="mt-1 text-xs text-muted">OFF by default · explicit consent required</p>
            </div>
            <button
              type="button"
              onClick={() => savePrefs({ ...prefs, enabled: !prefs.enabled })}
              className={`rounded-full px-4 py-2 text-[10px] tracking-[0.16em] uppercase ${
                prefs.enabled ? 'bg-emerald-400/90 text-void' : 'border border-ivory/20 text-soft'
              }`}
            >
              {prefs.enabled ? 'On' : 'Off'}
            </button>
          </div>

          {prefs.enabled && (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3">
              <p className="text-sm text-emerald-200">Guardian Mode Active</p>
              <p className="mt-2 text-xs text-soft/80">
                Wake-word detection runs locally. Emergency actions only after you opt in. Say
                “Safra”, “Safra help”, or “Safra emergency” while this tab is open.
              </p>
              <p className="mt-2 text-[10px] tracking-[0.14em] text-muted uppercase">
                Mic {supported ? (listening ? 'listening' : 'starting…') : 'unsupported — use Activate'}
              </p>
            </div>
          )}

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Stealth Mode (Notes disguise)</span>
            <input
              type="checkbox"
              checked={prefs.stealth}
              onChange={(e) => savePrefs({ ...prefs, stealth: e.target.checked })}
            />
          </label>
          {prefs.stealth && (
            <label className="block space-y-2 text-sm">
              <span className="text-[10px] tracking-[0.16em] text-muted uppercase">Disguise</span>
              <select
                value={prefs.stealthDisguise}
                onChange={(e) =>
                  savePrefs({
                    ...prefs,
                    stealthDisguise: e.target.value as StealthDisguise,
                  })
                }
                className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-2 text-sm outline-none"
              >
                {STEALTH_DISGUISE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Camera evidence (optional)</span>
            <input
              type="checkbox"
              checked={prefs.camera}
              onChange={(e) => savePrefs({ ...prefs, camera: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Auto-send evidence if Critical</span>
            <input
              type="checkbox"
              checked={prefs.autoSendCritical}
              onChange={(e) => savePrefs({ ...prefs, autoSendCritical: e.target.checked })}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-[10px] tracking-[0.16em] text-muted uppercase">Trusted contact</span>
              <input
                value={prefs.contactName}
                onChange={(e) => savePrefs({ ...prefs, contactName: e.target.value })}
                className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-2 text-sm outline-none"
                placeholder="Name"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-[10px] tracking-[0.16em] text-muted uppercase">Phone</span>
              <input
                value={prefs.contactPhone}
                onChange={(e) => savePrefs({ ...prefs, contactPhone: e.target.value })}
                className="w-full rounded-full border border-ivory/10 bg-void/40 px-4 py-2 text-sm outline-none"
                placeholder="Optional"
              />
            </label>
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}

          <button
            type="button"
            disabled={!prefs.enabled || activating}
            onClick={() => void activate('Safra help me')}
            className="w-full rounded-full bg-rose-400 px-6 py-3 text-[10px] tracking-[0.22em] text-void uppercase disabled:opacity-40"
          >
            {activating ? 'Activating…' : 'Activate now'}
          </button>

          <div className="flex gap-4 text-[10px] tracking-[0.16em] uppercase">
            <Link href="/report" className="text-gold-soft">
              Back to report
            </Link>
            <Link href="/" className="text-muted">
              Cover app
            </Link>
          </div>
        </div>
      </div>

      {session && (
        <GuardianOverlay
          token={token}
          caseId={session.caseId}
          publicId={session.publicId}
          stealthPreferred={prefs.stealth}
          stealthDisguise={prefs.stealthDisguise}
          cameraEnabled={prefs.camera}
          autoSendCritical={prefs.autoSendCritical}
          contact={
            prefs.contactName.trim()
              ? { name: prefs.contactName.trim(), phone: prefs.contactPhone.trim() }
              : null
          }
          onClose={() => setSession(null)}
        />
      )}
    </main>
  )
}
