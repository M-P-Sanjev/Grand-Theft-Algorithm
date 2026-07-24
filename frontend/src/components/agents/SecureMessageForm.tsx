'use client'

import { FormEvent, useState } from 'react'
import { API_BASE } from '@/lib/constants'

type Props = {
  caseId: string
  adminKey: string
  onSent?: () => void
}

export function SecureMessageForm({ caseId, adminKey, onSent }: Props) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setStatus('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/cases/${caseId}/secure-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: adminKey, message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Send failed')
        return
      }
      setStatus(`Encrypted message queued (${data.message_count || 1})`)
      setMessage('')
      onSent?.()
    } catch {
      setError('Backend unreachable')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-[1.25rem] border border-ivory/10 p-5">
      <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Secure channel</p>
      <textarea
        required
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="Encrypted note to survivor…"
        className="w-full rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none"
      />
      {error && <p className="text-sm text-amber-300">{error}</p>}
      {status && <p className="text-sm text-gold-soft">{status}</p>}
      <button
        type="submit"
        disabled={loading || !message.trim()}
        className="rounded-full border border-ivory/25 px-5 py-2.5 text-[10px] tracking-[0.2em] uppercase disabled:opacity-40"
      >
        {loading ? 'Sending…' : 'Send encrypted'}
      </button>
    </form>
  )
}
