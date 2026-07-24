'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ADMIN_KEY_STORAGE,
  API_BASE,
  SITE,
} from '@/lib/constants'

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
  escalation_contacts?: Record<string, string>
  evidence?: { filename: string; stored_as: string }[]
  created_at: string
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
    const s = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    if (s !== 0) return s
    const f = (FREQUENCY_RANK[a.frequency] ?? 9) - (FREQUENCY_RANK[b.frequency] ?? 9)
    if (f !== 0) return f
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export default function AdminPage() {
  const [keyInput, setKeyInput] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [cases, setCases] = useState<CaseRow[]>([])
  const [selected, setSelected] = useState<CaseRow | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [liveAt, setLiveAt] = useState<string>('')

  const loadCases = useCallback(async (key: string, quiet = false) => {
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
      const next = sortByPriority(data.cases || [])
      setCases(next)
      setLiveAt(new Date().toLocaleTimeString())
      setSelected((prev) => {
        if (!prev) return prev
        return next.find((c) => c.id === prev.id) || prev
      })
    } catch {
      setError('Backend unreachable')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_KEY_STORAGE)
    if (saved) {
      setAdminKey(saved)
      void loadCases(saved)
    }
  }, [loadCases])

  useEffect(() => {
    if (!adminKey) return
    const id = window.setInterval(() => {
      void loadCases(adminKey, true)
    }, 5000)
    return () => window.clearInterval(id)
  }, [adminKey, loadCases])

  const sorted = useMemo(() => sortByPriority(cases), [cases])

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

  if (!adminKey) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-void px-6 text-ivory">
        <form onSubmit={unlock} className="glass w-full max-w-md rounded-[1.5rem] p-8">
          <p className="font-display text-2xl tracking-[0.14em] text-gold">{SITE.name}</p>
          <h1 className="font-display mt-3 text-3xl">Support desk</h1>
          <p className="mt-2 text-sm text-soft/75">Enter admin key to view live cases.</p>
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
            <p className="text-[10px] tracking-[0.28em] text-gold uppercase">Live admin</p>
            <h1 className="font-display mt-2 text-4xl">Priority queue + map</h1>
            <p className="mt-2 text-sm text-soft/70">
              Sorted critical → high → medium → low
              {liveAt ? ` · refreshed ${liveAt}` : ''}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => loadCases(adminKey)}
              className="rounded-full border border-ivory/20 px-5 py-2 text-[10px] tracking-[0.2em] uppercase"
            >
              Refresh
            </button>
            <Link
              href="/"
              className="rounded-full border border-ivory/20 px-5 py-2 text-[10px] tracking-[0.2em] uppercase"
            >
              Menu
            </Link>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-amber-300">{error}</p>}
        {loading && <p className="mt-4 text-sm text-soft">Loading…</p>}

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-[1.25rem] border border-ivory/10">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-ivory/10 bg-panel/80 text-[10px] tracking-[0.18em] text-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Routing</th>
                  <th className="px-4 py-3">GPS</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className={`cursor-pointer border-b border-ivory/5 hover:bg-panel/60 ${
                      selected?.id === c.id ? 'bg-gold/10' : c.routing !== 'admin' ? 'bg-gold/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="uppercase">{c.severity}</span>
                      <span className="mt-1 block text-[10px] tracking-[0.14em] text-muted uppercase">
                        {c.frequency}
                      </span>
                    </td>
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] tracking-[0.14em] uppercase ${
                          c.routing === 'police'
                            ? 'bg-red-500/20 text-red-200'
                            : c.routing === 'ngo'
                              ? 'bg-amber-500/20 text-amber-100'
                              : 'bg-ivory/10 text-soft'
                        }`}
                      >
                        {c.routing}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-soft/80">
                      {typeof c.lat === 'number' && typeof c.lng === 'number' ? 'Live' : '—'}
                    </td>
                    <td className="px-4 py-3 uppercase">{c.status}</td>
                  </tr>
                ))}
                {!sorted.length && !loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-soft/70">
                      No cases yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <CasesMap
              cases={sorted}
              selectedId={selected?.id}
              onSelect={(id) => {
                const found = sorted.find((c) => c.id === id)
                if (found) setSelected(found)
              }}
            />
            <p className="mt-2 text-[10px] tracking-[0.16em] text-muted uppercase">
              Markers colored by severity · click a pin to open the case
            </p>
          </div>
        </div>

        {selected && (
          <div className="glass mt-8 rounded-[1.5rem] p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Case detail</p>
                <h2 className="font-display mt-2 text-3xl">{selected.name}</h2>
                <p className="mt-1 text-sm text-soft/70">
                  {selected.location || 'No area label'} · {selected.phone || 'No phone'}
                </p>
                {typeof selected.lat === 'number' && typeof selected.lng === 'number' ? (
                  <p className="mt-2 text-sm text-gold-soft">
                    Live coords: {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                    {selected.location_updated_at
                      ? ` · ${new Date(selected.location_updated_at).toLocaleString()}`
                      : ''}
                    <a
                      className="ml-3 underline"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=16/${selected.lat}/${selected.lng}`}
                    >
                      Open map
                    </a>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted">Location unavailable</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[10px] tracking-[0.2em] text-muted uppercase"
              >
                Close panel
              </button>
            </div>

            <p className="mt-6 whitespace-pre-wrap text-sm text-soft/90">{selected.notes}</p>

            {!!selected.evidence?.length && (
              <ul className="mt-4 space-y-1 text-sm text-soft/70">
                {selected.evidence.map((ev) => (
                  <li key={ev.stored_as}>📎 {ev.filename}</li>
                ))}
              </ul>
            )}

            {selected.escalation_contacts?.primary && (
              <p className="mt-5 rounded-2xl border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold-soft">
                Contact: {selected.escalation_contacts.primary}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
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
