'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '@/lib/constants'

function fmt(sec?: number | null) {
  if (sec == null || Number.isNaN(sec)) return '—'
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${String(r).padStart(2, '0')}s`
}

function bytesLabel(n?: number | null) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export type EvidenceMeta = {
  id?: string
  stored_as?: string
  filename?: string
  sha256?: string
  bytes?: number
  size?: number
  duration_sec?: number
  encrypted_at_rest?: boolean
  uploaded_at?: string
  pending?: boolean
}

export function EvidencePlayer({
  caseId,
  adminKey,
  evidence,
  recording,
}: {
  caseId: string
  adminKey: string
  evidence: EvidenceMeta | null | undefined
  recording?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  const evidenceId = evidence?.id || evidence?.stored_as || ''
  const evidenceKey = `${evidenceId}:${evidence?.sha256 || evidence?.bytes || 0}`

  useEffect(() => {
    if (!evidenceId || !adminKey) return
    let revoked = ''
    let cancelled = false
    setError('')
    setUrl('')
    void fetch(`${API_BASE}/cases/${caseId}/evidence/${evidenceId}`, {
      headers: { 'X-Admin-Key': adminKey },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const blob = await r.blob()
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        revoked = objectUrl
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load audio evidence')
      })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [caseId, adminKey, evidenceId, evidenceKey])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.playbackRate = rate
  }, [rate])

  const peaks = useMemo(() => Array.from({ length: 48 }, (_, i) => 20 + ((i * 17) % 60)), [])

  if (!evidenceId) {
    return (
      <div className="rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3 text-sm text-muted">
        {recording ? (
          <p>
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-400" />
            Live recording — audio is uploading to the command center…
          </p>
        ) : (
          <p>No audio evidence uploaded yet.</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ivory/10 bg-void/40 px-4 py-3">
      <p className="text-[10px] tracking-[0.2em] text-gold uppercase">Audio evidence</p>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      <audio
        ref={audioRef}
        src={url || undefined}
        preload="metadata"
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <div className="mt-3 flex h-10 items-end gap-0.5">
        {peaks.map((h, i) => {
          const active = duration > 0 && i / peaks.length <= progress / duration
          return (
            <span
              key={i}
              className={`flex-1 rounded-sm ${active ? 'bg-gold/80' : 'bg-ivory/20'}`}
              style={{ height: `${h}%` }}
            />
          )
        })}
      </div>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.05}
        value={progress}
        onChange={(e) => {
          const v = Number(e.target.value)
          setProgress(v)
          if (audioRef.current) audioRef.current.currentTime = v
        }}
        className="mt-2 w-full"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-ivory/20 px-3 py-1.5 text-[10px] tracking-wider uppercase"
          onClick={() => void audioRef.current?.play()}
        >
          Play
        </button>
        <button
          type="button"
          className="rounded-full border border-ivory/20 px-3 py-1.5 text-[10px] tracking-wider uppercase"
          onClick={() => audioRef.current?.pause()}
        >
          Pause
        </button>
        <button
          type="button"
          className="rounded-full border border-ivory/20 px-3 py-1.5 text-[10px] tracking-wider uppercase"
          onClick={() => {
            const a = audioRef.current
            if (!a) return
            a.pause()
            a.currentTime = 0
            setProgress(0)
            setPlaying(false)
          }}
        >
          Stop
        </button>
        {[0.5, 1, 1.5, 2].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRate(r)}
            className={`rounded-full px-2.5 py-1.5 text-[10px] tracking-wider uppercase ${
              rate === r ? 'bg-gold/90 text-void' : 'border border-ivory/20 text-soft'
            }`}
          >
            {r}x
          </button>
        ))}
        {url ? (
          <a
            href={url}
            download={evidence?.filename || 'guardian-audio.webm'}
            className="rounded-full border border-ivory/20 px-3 py-1.5 text-[10px] tracking-wider uppercase text-soft"
          >
            Download
          </a>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-soft/80">
        <div>
          <dt className="text-muted">Duration</dt>
          <dd>{fmt(evidence?.duration_sec ?? duration)}</dd>
        </div>
        <div>
          <dt className="text-muted">File size</dt>
          <dd>{bytesLabel(evidence?.bytes ?? evidence?.size)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Evidence hash</dt>
          <dd className="mt-0.5 break-all font-mono text-[10px] text-ivory/80">
            {evidence?.sha256 || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Encryption</dt>
          <dd>{evidence?.encrypted_at_rest ? 'At rest' : 'Stored'}</dd>
        </div>
        <div>
          <dt className="text-muted">Status</dt>
          <dd>{playing ? 'Playing' : evidence?.pending ? 'Pending' : 'Ready'}</dd>
        </div>
      </dl>
    </div>
  )
}
