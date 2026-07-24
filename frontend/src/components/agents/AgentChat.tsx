'use client'

import { FormEvent, useState } from 'react'
import { API_BASE } from '@/lib/constants'

type Source = {
  id?: string
  title?: string
  source?: string
  score?: number
}

type Props = {
  caseId: string
  kind: 'legal' | 'therapy'
  auth: { adminKey?: string; token?: string }
}

function AnswerBody({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div className="space-y-3 text-sm text-soft/90">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap leading-relaxed">
          {p.replace(/\*\*(.*?)\*\*/g, '$1')}
        </p>
      ))}
    </div>
  )
}

export function AgentChat({ caseId, kind, auth }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [mode, setMode] = useState('')
  const [intent, setIntent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/cases/${caseId}/agents/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          admin_key: auth.adminKey || undefined,
          token: auth.token || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Agent unavailable')
        return
      }
      setAnswer(data.answer || data.message || '')
      setSources(Array.isArray(data.sources) ? data.sources : [])
      setMode(data.source || '')
      setIntent(data.intent || '')
    } catch {
      setError('Could not reach agent')
    } finally {
      setLoading(false)
    }
  }

  const label = kind === 'legal' ? 'Legal guidance (RAG)' : 'Therapy support (RAG)'

  return (
    <div className="rounded-[1.25rem] border border-ivory/10 bg-void/30 p-5">
      <p className="text-[10px] tracking-[0.22em] text-gold uppercase">{label}</p>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder={
            kind === 'legal'
              ? 'Ask about protection orders, FIR, evidence…'
              : 'Share how you feel or ask for a calming step…'
          }
          className="w-full rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-ivory outline-none placeholder:text-muted"
        />
        {error && <p className="text-sm text-amber-300">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-ivory px-5 py-2.5 text-[10px] tracking-[0.2em] text-void uppercase disabled:opacity-40"
        >
          {loading ? 'Retrieving…' : 'Ask agent'}
        </button>
      </form>
      {answer && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3">
            <AnswerBody text={answer} />
          </div>
          {!!sources.length && (
            <div className="rounded-2xl border border-ivory/10 px-4 py-3">
              <p className="text-[10px] tracking-[0.18em] text-muted uppercase">
                Sources{mode ? ` · ${mode}` : ''}
                {intent ? ` · ${intent}` : ''}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-soft/75">
                {sources.map((s) => (
                  <li key={s.id || s.title}>
                    {s.title || s.source || s.id}
                    {typeof s.score === 'number' ? ` (${s.score})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
