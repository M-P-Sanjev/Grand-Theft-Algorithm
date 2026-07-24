'use client'

import { FormEvent, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_BASE } from '@/lib/constants'
import { CrisisPipeline, PipelineStage } from '@/components/crisis/CrisisPipeline'
import { RiskPanel } from '@/components/crisis/RiskPanel'

type Role = 'user' | 'assistant'
type SourceCard = {
  law_ref?: string
  section?: string
  title?: string
  source?: string
  confidence?: number
  snippet?: string
}

type ChatMessage = {
  id: string
  role: Role
  content: string
  createdAt: number
  sources?: SourceCard[]
  confidence?: number
  phase?: string
  streaming?: boolean
}

type Props = {
  caseId: string
  kind: 'legal' | 'therapy'
  auth: { adminKey?: string; token?: string }
  onCrisisUpdate?: (payload: {
    risk_index?: number
    tier?: string
    live_status?: Record<string, unknown>
    ai_summary?: Record<string, unknown>
    next_actions?: unknown
    confidence?: number
    reasons?: string[]
    scores?: Record<string, number>
    trend?: string
    delta?: number
    risk_history?: { at?: string; score?: number; tier?: string }[]
    timeline?: { at: string; event: string; detail?: string }[]
    emotion?: { primary?: string }
  }) => void
}

const PROMPTS: Record<'legal' | 'therapy', string[]> = {
  legal: [
    'How can the court keep him away from me?',
    'I want to tell the police what happened',
    'What are my rights in plain words?',
    'He threatened my child — what can I do?',
  ],
  therapy: [
    'My husband hit me yesterday',
    "I'm scared",
    'I feel alone',
    'I am okay now',
    'Help me feel safer tonight',
  ],
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function AiChatPanel({ caseId, kind, auth, onCrisisUpdate }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [pipeline, setPipeline] = useState<PipelineStage[]>([])
  const [risk, setRisk] = useState<{
    tier?: string
    index?: number
    confidence?: number
    reasons?: string[]
    scores?: Record<string, number>
    trend?: string
    delta?: number
    history?: { at?: string; score?: number; tier?: string }[]
  }>({})
  const [calculating, setCalculating] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const title = kind === 'legal' ? 'Legal companion' : 'Crisis companion'
  const subtitle =
    kind === 'legal'
      ? 'Rights in plain words · one step at a time'
      : 'Calm support · listen first · never overwhelm'

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setError('')
    setBusy(true)
    setPhase('listening')
    setInput('')
    setPipeline([
      { id: 'incoming_note', label: 'User message received', active: true },
    ])
    setCalculating(true)

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: q,
      createdAt: Date.now(),
    }
    const assistantId = uid()
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        streaming: true,
        phase: 'listening',
      },
    ])

    try {
      const res = await fetch(`${API_BASE}/cases/${caseId}/agents/${kind}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          session_id: sessionId || undefined,
          admin_key: auth.adminKey || undefined,
          token: auth.token || undefined,
        }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          typeof data.detail === 'string' ? data.detail : 'Connection issue',
        )
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventName = 'message'

      const applyAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
        )
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const block of parts) {
          const lines = block.split('\n')
          let dataLine = ''
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            if (line.startsWith('data:')) dataLine += line.slice(5).trim()
          }
          if (!dataLine) continue
          let payload: Record<string, unknown> = {}
          try {
            payload = JSON.parse(dataLine)
          } catch {
            continue
          }

          if (eventName === 'session' && typeof payload.session_id === 'string') {
            setSessionId(payload.session_id)
          }
          if (eventName === 'status' && typeof payload.phase === 'string') {
            setPhase(payload.phase)
            applyAssistant({ phase: payload.phase })
          }
          if (eventName === 'pipeline') {
            const stages = (payload.stages as { id: string; label: string }[]) || []
            setPipeline(
              stages.map((s, i) => ({
                ...s,
                done: true,
                active: i === stages.length - 1,
              })),
            )
            setRisk({
              tier: payload.tier as string | undefined,
              index: payload.risk_index as number | undefined,
              confidence: payload.confidence as number | undefined,
              reasons: payload.reasons as string[] | undefined,
              scores: payload.scores as Record<string, number> | undefined,
              trend: payload.trend as string | undefined,
              delta: payload.delta as number | undefined,
              history: payload.risk_history as
                | { at?: string; score?: number; tier?: string }[]
                | undefined,
            })
            setCalculating(false)
            onCrisisUpdate?.({
              risk_index: payload.risk_index as number | undefined,
              tier: payload.tier as string | undefined,
              ai_summary: payload.ai_summary as Record<string, unknown>,
              next_actions: payload.next_actions,
              confidence: payload.confidence as number | undefined,
              reasons: payload.reasons as string[] | undefined,
              scores: payload.scores as Record<string, number> | undefined,
              trend: payload.trend as string | undefined,
              delta: payload.delta as number | undefined,
              risk_history: payload.risk_history as
                | { at?: string; score?: number; tier?: string }[]
                | undefined,
              timeline: payload.timeline as
                | { at: string; event: string; detail?: string }[]
                | undefined,
              emotion: payload.emotion as { primary?: string } | undefined,
            })
          }
          if (eventName === 'meta') {
            applyAssistant({
              sources: (payload.sources as SourceCard[]) || [],
              confidence: Number(payload.confidence || 0),
            })
            if (payload.tier || payload.risk_index) {
              setRisk({
                tier: payload.tier as string | undefined,
                index: payload.risk_index as number | undefined,
              })
            }
          }
          if (eventName === 'token' && typeof payload.t === 'string') {
            setPhase('streaming')
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: m.content + payload.t,
                      streaming: true,
                      phase: 'streaming',
                    }
                  : m,
              ),
            )
          }
          if (eventName === 'error') {
            setError(String(payload.message || 'Something went wrong'))
          }
          if (eventName === 'done') {
            applyAssistant({ streaming: false, phase: 'done' })
            setPhase('')
            onCrisisUpdate?.({
              risk_index: payload.risk_index as number | undefined,
              tier: payload.tier as string | undefined,
              live_status: payload.live_status as Record<string, unknown>,
            })
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach companion')
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  m.content ||
                  "I'm still here. The connection hiccuped — try sending that again when you can.",
                streaming: false,
              }
            : m,
        ),
      )
    } finally {
      setBusy(false)
      setPhase('')
      setCalculating(false)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(input)
  }

  const prompts = useMemo(() => PROMPTS[kind], [kind])
  const phaseLabel =
    phase === 'listening'
      ? 'Listening'
      : phase === 'streaming'
        ? 'Responding'
        : busy
          ? 'Understanding'
          : ''

  return (
    <div className="relative flex h-[620px] flex-col overflow-hidden rounded-[1.5rem] border border-ivory/10 bg-gradient-to-b from-panel/90 to-void/90">
      <header className="relative z-10 border-b border-ivory/10 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl tracking-wide text-ivory">{title}</p>
            <p className="mt-1 text-[10px] tracking-[0.18em] text-muted uppercase">
              {subtitle}
            </p>
          </div>
          {risk.tier && (
            <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[10px] tracking-[0.14em] text-gold-soft uppercase">
              {risk.tier}
              {typeof risk.index === 'number' ? ` ${risk.index}` : ''}
            </span>
          )}
        </div>
        {phaseLabel && (
          <p className="mt-3 text-xs text-gold-soft">{phaseLabel}…</p>
        )}
      </header>

      {pipeline.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-ivory/10 px-3 py-2">
          <CrisisPipeline
            stages={pipeline}
            title="Live AI pipeline"
            riskIndex={risk.index}
            tier={risk.tier}
          />
          {(typeof risk.index === 'number' || calculating) && (
            <div className="mt-3">
              <RiskPanel
                score={risk.index || 0}
                tier={risk.tier || 'LOW'}
                confidence={risk.confidence}
                reasons={risk.reasons}
                scores={risk.scores}
                trend={risk.trend}
                delta={risk.delta}
                history={risk.history}
                calculating={calculating}
              />
            </div>
          )}
        </div>
      )}

      <div className="relative z-10 flex shrink-0 gap-2 overflow-x-auto px-4 py-3">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => void ask(p)}
            className="shrink-0 rounded-full border border-ivory/15 bg-void/40 px-3 py-1.5 text-[11px] text-soft transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="relative z-10 min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
        {messages.length === 0 && (
          <div className="mt-8 space-y-2 text-center text-sm text-muted">
            <p>
              {kind === 'therapy'
                ? 'Tell me what happened — I will stay with you, one step at a time.'
                : 'Ask what you need in everyday words. I will explain your rights simply.'}
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-br-md bg-gold/20 text-ivory'
                    : 'rounded-bl-md border border-ivory/10 bg-void/55 text-soft/95'
                }`}
              >
                {m.role === 'assistant' && (
                  <p className="mb-2 text-[10px] tracking-[0.16em] text-gold uppercase">
                    {m.streaming ? 'With you' : 'Companion'}
                  </p>
                )}
                <div className="prose prose-invert prose-sm max-w-none prose-p:my-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content.length > 0 ? m.content : m.streaming ? '...' : ' '}
                  </ReactMarkdown>
                </div>
                {m.role === 'assistant' && !!m.sources?.length && (
                  <div className="mt-3 space-y-2 border-t border-ivory/10 pt-3">
                    <p className="text-[10px] tracking-[0.18em] text-muted uppercase">
                      Helpful info
                    </p>
                    {m.sources.slice(0, 3).map((s, i) => (
                      <div
                        key={`${s.title}-${i}`}
                        className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-xs"
                      >
                        <p className="text-gold-soft">{s.law_ref || s.title}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 text-xs text-red-300">{error}</p>
      )}

      <form
        onSubmit={onSubmit}
        className="relative z-10 border-t border-ivory/10 p-3"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              kind === 'therapy'
                ? 'What happened? Are you safe right now?'
                : 'What would you like help with?'
            }
            className="flex-1 rounded-2xl border border-ivory/15 bg-void/60 px-4 py-3 text-sm text-ivory outline-none focus:border-gold/40"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-2xl bg-ivory px-5 py-3 text-[10px] tracking-[0.18em] text-void uppercase disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
