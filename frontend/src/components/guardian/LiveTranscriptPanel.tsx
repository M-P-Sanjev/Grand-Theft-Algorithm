'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const HIGHLIGHT = [
  'weapon',
  'knife',
  'bat',
  'gun',
  'bleeding',
  'blood',
  'locked',
  'kill',
  'help',
  'children',
  'child',
  'kids',
  'pregnant',
  'suicide',
  'scared',
  'hit',
  'punch',
  'beat',
]

function fmt(sec?: number) {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function highlightText(text: string) {
  const re = new RegExp(`\\b(${HIGHLIGHT.join('|')})\\b`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) => {
    if (HIGHLIGHT.some((h) => h.toLowerCase() === part.toLowerCase())) {
      const critical = /gun|knife|bat|kill|weapon|suicide|bleeding|blood/i.test(part)
      return (
        <mark
          key={i}
          className={
            critical
              ? 'rounded bg-rose-500/30 px-0.5 text-rose-100'
              : 'rounded bg-amber-400/25 px-0.5 text-amber-100'
          }
        >
          {part}
        </mark>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export type LiveLine = { text?: string; at?: string; t_sec?: number; final?: boolean }

export function LiveTranscriptPanel({
  lines,
  recording,
  emptyHint,
}: {
  lines: LiveLine[]
  recording?: boolean
  emptyHint?: string
}) {
  const [query, setQuery] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = lines || []
    if (!q) return list
    return list.filter((l) => (l.text || '').toLowerCase().includes(q))
  }, [lines, query])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filtered.length, recording])

  return (
    <div className="rounded-2xl border border-rose-400/25 bg-rose-500/5 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] tracking-[0.2em] text-rose-300 uppercase">Live transcript</p>
        {recording ? (
          <span className="text-[10px] tracking-[0.16em] text-rose-200 uppercase">● LIVE</span>
        ) : null}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search transcript…"
        className="mt-3 w-full rounded-xl border border-ivory/10 bg-void/50 px-3 py-2 text-xs text-ivory outline-none"
      />
      <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto text-sm text-ivory">
        {filtered.length === 0 && (
          <li className="text-muted">{emptyHint || 'Waiting for speech…'}</li>
        )}
        {filtered.map((l, i) => (
          <li key={`${l.at || l.t_sec}-${i}`} className="flex gap-2">
            <span className="shrink-0 font-mono text-[10px] text-muted">
              {fmt(typeof l.t_sec === 'number' ? l.t_sec : undefined)}
            </span>
            <span>“{highlightText(l.text || '')}”</span>
          </li>
        ))}
        <div ref={bottomRef} />
      </ul>
    </div>
  )
}
