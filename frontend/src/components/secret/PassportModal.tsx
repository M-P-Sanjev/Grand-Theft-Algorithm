'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { API_BASE, PASSPORT_TOKEN_KEY } from '@/lib/constants'

type Props = {
  open: boolean
  onClose: () => void
}

export function PassportModal({ open, onClose }: Props) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/verify-passport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Invalid delivery code')
        return
      }
      sessionStorage.setItem(PASSPORT_TOKEN_KEY, data.token)
      onClose()
      router.push('/report')
    } catch {
      setError('Service unavailable. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="passport-title"
        className="w-full max-w-md rounded-[1.5rem] border border-ivory/10 bg-panel p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        <p className="text-[10px] tracking-[0.28em] text-gold uppercase">Delivery</p>
        <h2 id="passport-title" className="font-display mt-2 text-3xl text-ivory">
          Enter delivery code
        </h2>
        <p className="mt-2 text-sm text-soft/75">
          Confirm your order code to continue. This looks like a normal checkout step.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="password"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Delivery code"
            className="w-full rounded-full border border-ivory/15 bg-void/50 px-5 py-3 text-sm text-ivory outline-none placeholder:text-muted focus:border-gold/40"
          />
          {error && <p className="text-sm text-amber-300/90">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border border-ivory/15 py-3 text-[10px] tracking-[0.22em] text-soft uppercase"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="flex-1 rounded-full bg-ivory py-3 text-[10px] tracking-[0.22em] text-void uppercase disabled:opacity-40"
            >
              {loading ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
