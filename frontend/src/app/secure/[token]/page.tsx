'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { API_BASE, SITE } from '@/lib/constants'
import { AgentChat } from '@/components/agents/AgentChat'

type SecureMsg = {
  id?: string
  sender?: string
  body?: string
  at?: string
}

export default function SecureChannelPage() {
  const params = useParams()
  const token = String(params.token || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [caseId, setCaseId] = useState('')
  const [routing, setRouting] = useState('')
  const [riskTier, setRiskTier] = useState('')
  const [legalTip, setLegalTip] = useState('')
  const [therapyTip, setTherapyTip] = useState('')
  const [messages, setMessages] = useState<SecureMsg[]>([])
  const [reply, setReply] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/secure/${token}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Channel unavailable')
        return
      }
      setCaseId(data.case_id || '')
      setRouting(data.routing || '')
      setRiskTier(data.risk_tier || '')
      setLegalTip(data.legal_tip || '')
      setTherapyTip(data.therapy_tip || '')
      setMessages(data.messages || [])
    } catch {
      setError('Backend unreachable')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) void load()
  }, [token])

  async function onReply(e: FormEvent) {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/secure/${token}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: reply }),
    })
    if (res.ok) {
      setReply('')
      void load()
    }
  }

  return (
    <main className="min-h-[100svh] bg-void text-ivory">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="font-display text-2xl tracking-[0.14em] text-gold">{SITE.name}</p>
        <h1 className="font-display mt-4 text-4xl">Secure channel</h1>
        <p className="mt-2 text-sm text-soft/75">Private messages for your support order.</p>

        {loading && <p className="mt-8 text-soft">Opening…</p>}
        {error && <p className="mt-8 text-amber-300">{error}</p>}

        {!loading && !error && (
          <div className="mt-8 space-y-6">
            <div className="glass rounded-[1.5rem] p-6 text-sm">
              <p>
                Risk: <span className="text-gold uppercase">{riskTier || '—'}</span>
                <span className="mx-2 text-muted">·</span>
                Routed: <span className="uppercase">{routing}</span>
              </p>
              {legalTip && (
                <p className="mt-4 whitespace-pre-wrap text-soft/85">{legalTip}</p>
              )}
              {therapyTip && (
                <p className="mt-3 whitespace-pre-wrap text-soft/85">{therapyTip}</p>
              )}
            </div>

            <div className="space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    m.sender === 'admin'
                      ? 'border-gold/25 bg-gold/10'
                      : 'border-ivory/10 bg-void/40'
                  }`}
                >
                  <p className="text-[10px] tracking-[0.18em] text-muted uppercase">
                    {m.sender} · {m.at ? new Date(m.at).toLocaleString() : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
              {!messages.length && (
                <p className="text-sm text-muted">No messages yet.</p>
              )}
            </div>

            <form onSubmit={onReply} className="space-y-3">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3 text-sm outline-none"
                placeholder="Reply securely…"
              />
              <button
                type="submit"
                className="rounded-full bg-ivory px-6 py-3 text-[10px] tracking-[0.22em] text-void uppercase"
              >
                Send reply
              </button>
            </form>

            {caseId && (
              <div className="grid gap-4 md:grid-cols-2">
                <AgentChat caseId={caseId} kind="legal" auth={{ token }} />
                <AgentChat caseId={caseId} kind="therapy" auth={{ token }} />
              </div>
            )}

            <Link href="/" className="inline-block text-[10px] tracking-[0.2em] text-muted uppercase">
              Back to menu
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
