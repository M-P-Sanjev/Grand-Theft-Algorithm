'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { API_BASE } from '@/lib/constants'
import { useLiveSocket, type LiveEvent } from '@/hooks/useLiveSocket'
import { useGuardianStt, type TranscriptLine } from '@/hooks/useGuardianStt'
import { StealthShell, type StealthDisguise } from '@/components/guardian/StealthShell'

type Beat = { t: string; title: string; detail?: string }
type CapLine = { text: string; t_sec: number; at?: string; final?: boolean }

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function blobToB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

export function GuardianOverlay({
  token,
  caseId,
  publicId,
  stealthPreferred,
  stealthDisguise = 'shopping',
  cameraEnabled,
  contact,
  autoSendCritical,
  onClose,
}: {
  token: string
  caseId: string
  publicId?: string
  stealthPreferred?: boolean
  stealthDisguise?: StealthDisguise
  cameraEnabled?: boolean
  contact?: { name: string; phone: string } | null
  autoSendCritical?: boolean
  onClose?: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  const [lines, setLines] = useState<CapLine[]>([])
  const [transcript, setTranscript] = useState('')
  const [beats, setBeats] = useState<Beat[]>([
    { t: fmt(0), title: 'Guardian activated' },
    { t: fmt(0), title: 'Recording started' },
  ])
  const [risk, setRisk] = useState<{ score?: number; tier?: string }>({})
  const [emotion, setEmotion] = useState('')
  const [violence, setViolence] = useState('')
  const [liveSummary, setLiveSummary] = useState('')
  const [stealth, setStealth] = useState(!!stealthPreferred)
  const [countdown, setCountdown] = useState(contact ? 10 : null)
  const [contactSent, setContactSent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [manualDraft, setManualDraft] = useState('')
  const [postError, setPostError] = useState('')
  const [transcriptLive, setTranscriptLive] = useState(false)
  const [audioStatus, setAudioStatus] = useState<{
    recording: boolean
    chunks: number
    lastUploadOk: boolean
    error?: string
  }>({ recording: false, chunks: 0, lastUploadOk: true })
  const lastPostedRef = useRef('')
  const livePulseRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const postedKeysRef = useRef<Set<string>>(new Set())

  const pushBeat = useCallback((title: string, detail?: string) => {
    setBeats((prev) => {
      if (prev.some((b) => b.title === title && b.detail === detail)) return prev
      return [...prev.slice(-16), { t: fmt(seconds), title, detail }]
    })
  }, [seconds])

  const postTranscript = useCallback(
    async (text: string, final = false, t_sec?: number, source = 'browser') => {
      const cleaned = text.trim().replace(/\s+/g, ' ')
      if (!cleaned) return
      if (!final && cleaned.length < 2) return
      const sec = typeof t_sec === 'number' ? t_sec : seconds

      // Local live lines: replace growing partial; append each final utterance
      setTranscript(cleaned)
      setLines((prev) => {
        const last = prev[prev.length - 1]
        const lastText = (last?.text || '').trim().toLowerCase()
        const nextText = cleaned.toLowerCase()
        if (last && lastText === nextText) {
          return prev.map((l, i) =>
            i === prev.length - 1 ? { ...l, text: cleaned, t_sec: sec, final: final || l.final } : l,
          )
        }
        if (last && !last.final && (!final || nextText.startsWith(lastText) || lastText.startsWith(nextText))) {
          const copy = [...prev]
          copy[copy.length - 1] = { text: cleaned, t_sec: sec, final: !!final }
          return copy.slice(-40)
        }
        if (final) {
          return [...prev, { text: cleaned, t_sec: sec, final: true }].slice(-40)
        }
        return [...prev, { text: cleaned, t_sec: sec, final: false }].slice(-40)
      })

      // Dedupe identical finals already POSTed
      if (final) {
        const key = cleaned.toLowerCase()
        if (postedKeysRef.current.has(key)) return
        postedKeysRef.current.add(key)
        if (postedKeysRef.current.size > 200) {
          postedKeysRef.current = new Set([...postedKeysRef.current].slice(-100))
        }
      } else if (cleaned === lastPostedRef.current) {
        return
      }
      lastPostedRef.current = cleaned

      setPostError('')
      if (final) pushBeat('Speech Detected', `"${cleaned.slice(0, 80)}"`)

      console.log('[transcript] Transcript emitted to backend', { final, text: cleaned })
      try {
        const res = await fetch(`${API_BASE}/guardian/${caseId}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            text: cleaned,
            final,
            t_sec: sec,
            source,
          }),
        })
        if (!res.ok) {
          if (final) postedKeysRef.current.delete(cleaned.toLowerCase())
          const data = await res.json().catch(() => ({}))
          const detail =
            typeof data.detail === 'string'
              ? data.detail
              : res.status === 401
                ? 'Session expired — reopen Water / passport'
                : `Transcript failed (${res.status})`
          setPostError(detail)
          return
        }
        setTranscriptLive(true)
        if (livePulseRef.current) clearTimeout(livePulseRef.current)
        livePulseRef.current = setTimeout(() => setTranscriptLive(false), 3000)
        const data = await res.json().catch(() => ({}))
        if (typeof data.risk_score === 'number') {
          setRisk({ score: data.risk_score, tier: data.risk_tier })
        }
        if (data.guardian?.live_summary) setLiveSummary(String(data.guardian.live_summary))
      } catch {
        if (final) postedKeysRef.current.delete(cleaned.toLowerCase())
        setPostError('Could not reach server — check backend is running')
      }
    },
    [caseId, token, pushBeat, seconds],
  )

  const onSttLine = useCallback(
    (line: TranscriptLine) => {
      void postTranscript(line.text, !!line.final, line.t_sec, line.source || 'browser')
    },
    [postTranscript],
  )

  const {
    listenState,
    isRecording,
    tickSeconds,
    getRecordingBlob,
    stopRecording,
    pushLiveSnapshot,
  } = useGuardianStt({
    caseId,
    token,
    enabled: true,
    onLine: onSttLine,
    onAudioStatus: setAudioStatus,
  })

  // First snapshot soon after recording starts so admin gets audio quickly
  useEffect(() => {
    if (!isRecording) return
    const t = setTimeout(() => {
      void pushLiveSnapshot()
    }, 3500)
    return () => clearTimeout(t)
  }, [isRecording, pushLiveSnapshot])

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((s) => {
        const n = s + 1
        tickSeconds(n)
        return n
      })
    }, 1000)
    return () => clearInterval(id)
  }, [tickSeconds])

  useEffect(() => {
    if (!cameraEnabled) return
    const t = setTimeout(() => {
      void navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then(() => pushBeat('Camera ready', 'Photo capture armed'))
        .catch(() => undefined)
    }, 1200)
    return () => clearTimeout(t)
  }, [cameraEnabled, pushBeat])

  function submitManualTranscript() {
    const t = manualDraft.trim()
    if (!t) return
    void postTranscript(t, true, seconds, 'manual')
    setManualDraft('')
  }

  useLiveSocket({
    caseId,
    role: 'victim',
    enabled: true,
    onEvent: (ev: LiveEvent) => {
      if (ev.case_id && ev.case_id !== caseId) return
      if (ev.type === 'transcript_chunk' && typeof ev.text === 'string') {
        setTranscript(ev.text)
      }
      if (typeof ev.risk_score === 'number') {
        setRisk({ score: ev.risk_score, tier: String(ev.risk_tier || '') })
        pushBeat('Risk updated', `${ev.risk_score} ${String(ev.risk_tier || '').toUpperCase()}`)
      }
      if (ev.type === 'guardian_summary' && typeof ev.live_summary === 'string') {
        setLiveSummary(ev.live_summary)
      }
      if (ev.type === 'detected_event') {
        const event = ev.event as { label?: string } | undefined
        if (event?.label) pushBeat(event.label, String(ev.text || '').slice(0, 60))
      }
      if (ev.type === 'pipeline_stage') {
        if (ev.stage === 'emotion_detected') {
          const d = ev.detail as { primary?: string; confidence?: number } | undefined
          const label = d?.primary
            ? `${d.primary} (${Math.round((d.confidence || 0.9) * 100)}%)`
            : ev.label
          setEmotion(String(label || ''))
          pushBeat('Emotion', String(label || ''))
        }
        if (ev.stage === 'violence_detected') {
          setViolence(String(ev.label || 'Violence detected'))
          pushBeat('Violence', String(ev.label || ''))
        }
        if (ev.stage === 'admin_notified' || ev.stage === 'dashboard_sync') {
          pushBeat('Admin Dashboard Updated')
        }
      }
    },
  })

  useEffect(() => {
    const id = setInterval(() => {
      void fetch(`${API_BASE}/cases/${caseId}/status?token=${encodeURIComponent(token)}`)
        .then((r) => r.json())
        .then((data) => {
          if (typeof data.risk_score === 'number') {
            setRisk({ score: data.risk_score, tier: data.risk_tier })
          }
          const tail = data.guardian?.transcript as CapLine[] | undefined
          if (tail?.length) {
            setLines(tail.slice(-40).map((l) => ({ text: l.text, t_sec: l.t_sec ?? 0 })))
            setTranscript(tail[tail.length - 1]?.text || '')
          }
          if (data.guardian?.live_summary) setLiveSummary(String(data.guardian.live_summary))
        })
        .catch(() => undefined)
    }, 2500)
    return () => clearInterval(id)
  }, [caseId, token])

  useEffect(() => {
    if (countdown == null || contactSent) return
    if (countdown <= 0) {
      setContactSent(true)
      pushBeat('Emergency Contact Ready')
      void fetch(`${API_BASE}/guardian/${caseId}/contact-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          contact_name: contact?.name,
          contact_phone: contact?.phone,
        }),
      }).then(() => pushBeat('Trusted contact notified'))
      return
    }
    const t = setTimeout(() => setCountdown((c) => (c == null ? c : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown, contactSent, caseId, token, contact, pushBeat])

  async function confirmUpload() {
    setUploading(true)
    try {
      stopRecording()
      await new Promise((r) => setTimeout(r, 500))
      const blob = getRecordingBlob()
      const critical = (risk.tier || '').toLowerCase() === 'critical'
      if (blob && blob.size > 0) {
        const content_b64 = await blobToB64(blob)
        await fetch(`${API_BASE}/guardian/${caseId}/evidence/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            filename: 'guardian-audio.webm',
            content_b64,
            duration_sec: seconds,
            confirm_upload: true,
          }),
        })
      } else {
        await fetch(`${API_BASE}/guardian/${caseId}/evidence/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            duration_sec: seconds,
            confirm_upload: true,
          }),
        })
      }
      pushBeat('Evidence Saved')
      if (critical && autoSendCritical) pushBeat('Evidence sent (critical policy)')
    } finally {
      setUploading(false)
    }
  }

  // Auto-finalize on unload
  useEffect(() => {
    const onHide = () => {
      const blob = getRecordingBlob()
      if (!blob) return
      void blobToB64(blob).then((content_b64) => {
        void fetch(`${API_BASE}/guardian/${caseId}/evidence/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            filename: 'guardian-audio.webm',
            content_b64,
            duration_sec: secondsRefSafe(seconds),
            confirm_upload: true,
          }),
          keepalive: true,
        })
      })
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide()
    })
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
    }
  }, [caseId, token, getRecordingBlob, seconds])

  if (stealth) {
    return (
      <StealthShell
        disguise={stealthDisguise}
        isRecording={isRecording}
        seconds={seconds}
        riskLabel={
          risk.score != null
            ? `${risk.score} ${(risk.tier || '').toUpperCase() || 'ANALYSING'}`
            : 'Analysing'
        }
        audioQuality={isRecording ? 'Excellent' : 'Saved'}
        liveTranscript={transcript}
        transcriptLive={transcriptLive}
        postError={postError}
        onManualTranscript={(text) => {
          void postTranscript(text, true, seconds, 'manual')
        }}
        onPanicExit={() => {
          stopRecording()
          onClose?.()
        }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-void/80 p-4 backdrop-blur-sm md:items-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-rose-400/25 bg-[#140f12] p-6 text-ivory shadow-2xl"
      >
        <motion.div
          className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-rose-500/20"
          animate={{ scale: [1, 1.25, 1], opacity: [0.35, 0.55, 0.35] }}
          transition={{ repeat: Infinity, duration: 2.4 }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.28em] text-rose-300/90 uppercase">
              Guardian Activated
            </p>
            {publicId && <p className="mt-1 text-xs text-muted">{publicId}</p>}
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl text-rose-200">{fmt(seconds)}</p>
            <p className="text-[10px] tracking-[0.16em] text-muted uppercase">
              {isRecording ? 'Recording' : 'Recorded'}
            </p>
            {audioStatus.chunks > 0 ? (
              <p className="mt-1 text-[10px] text-emerald-300/90">
                Audio → admin ({audioStatus.chunks} slices)
              </p>
            ) : audioStatus.error ? (
              <p className="mt-1 text-[10px] text-rose-300">{audioStatus.error}</p>
            ) : (
              <p className="mt-1 text-[10px] text-muted">Arming mic…</p>
            )}
          </div>
        </div>

        <div className="relative mt-5 flex h-12 items-end gap-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <motion.span
              key={i}
              className={`flex-1 rounded-full ${isRecording ? 'bg-rose-400/70' : 'bg-ivory/25'}`}
              animate={isRecording ? { height: [6, 12 + (i % 5) * 6, 8] } : { height: 6 }}
              transition={
                isRecording
                  ? { repeat: Infinity, duration: 0.8 + (i % 4) * 0.1, delay: i * 0.03 }
                  : { duration: 0.2 }
              }
            />
          ))}
        </div>

        <div className="relative mt-5 rounded-2xl border border-ivory/10 bg-void/50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] tracking-[0.18em] text-muted uppercase">Live transcript</p>
            <p className="text-[10px] tracking-[0.14em] text-muted uppercase">
              {transcriptLive
                ? '● Transcript live'
                : listenState === 'listening'
                  ? '● Live'
                  : listenState === 'gemini'
                    ? '● Gemini STT'
                    : listenState === 'starting'
                      ? 'Starting…'
                      : listenState === 'unsupported'
                        ? 'Type below'
                        : 'Retrying…'}
            </p>
          </div>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-sm text-soft">
            {lines.length === 0 && (
              <li className="text-muted">Speak now — captions appear with timestamps…</li>
            )}
            {lines.slice(-12).map((l, i) => (
              <li key={`${l.t_sec}-${i}`} className="flex gap-2">
                <span className="shrink-0 font-mono text-[10px] text-muted">{fmt(l.t_sec)}</span>
                <span>“{l.text}”</span>
              </li>
            ))}
          </ul>
          {postError ? <p className="mt-2 text-[11px] text-rose-300">{postError}</p> : null}
          <div className="mt-3 flex gap-2">
            <input
              value={manualDraft}
              onChange={(e) => setManualDraft(e.target.value)}
              onBlur={() => {
                if (manualDraft.trim().length >= 4) submitManualTranscript()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitManualTranscript()
                }
              }}
              placeholder="Type what was said…"
              className="min-w-0 flex-1 rounded-xl border border-ivory/15 bg-void/60 px-3 py-2 text-xs text-ivory outline-none"
            />
            <button
              type="button"
              onClick={submitManualTranscript}
              className="rounded-xl border border-ivory/20 px-3 py-2 text-[10px] tracking-[0.14em] text-soft uppercase"
            >
              Send
            </button>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-ivory/10 px-3 py-2">
            <p className="text-muted">Emotion</p>
            <p className="mt-1 text-ivory">{emotion || '—'}</p>
          </div>
          <div className="rounded-xl border border-ivory/10 px-3 py-2">
            <p className="text-muted">Risk</p>
            <p className="mt-1 text-rose-200">
              {risk.score != null ? `${risk.score} ${(risk.tier || '').toUpperCase()}` : 'Analysing…'}
            </p>
          </div>
          {violence && (
            <div className="col-span-2 rounded-xl border border-rose-400/20 px-3 py-2 text-rose-200">
              {violence}
            </div>
          )}
          {liveSummary && (
            <div className="col-span-2 rounded-xl border border-ivory/10 px-3 py-2 text-soft/90">
              {liveSummary}
            </div>
          )}
        </div>

        <ul className="relative mt-4 max-h-36 space-y-2 overflow-y-auto text-xs text-soft/90">
          <AnimatePresence initial={false}>
            {beats.map((b, i) => (
              <motion.li
                key={`${b.title}-${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex gap-3"
              >
                <span className="font-mono text-muted">{b.t}</span>
                <span>
                  {b.title}
                  {b.detail ? <span className="text-muted"> — {b.detail}</span> : null}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {countdown != null && !contactSent && (
          <div className="relative mt-4 rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3">
            <p className="text-sm text-ivory">Notify trusted contact?</p>
            <p className="mt-1 font-mono text-2xl text-gold">{countdown}</p>
            <button
              type="button"
              className="mt-2 text-[10px] tracking-[0.18em] text-muted uppercase"
              onClick={() => {
                setCountdown(null)
                pushBeat('Contact notify cancelled')
              }}
            >
              Cancel
            </button>
          </div>
        )}

        <div className="relative mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void confirmUpload()}
            disabled={uploading}
            className="rounded-full bg-rose-400/90 px-4 py-2 text-[10px] tracking-[0.16em] text-void uppercase"
          >
            {uploading ? 'Saving…' : 'Save evidence'}
          </button>
          <button
            type="button"
            onClick={() => setStealth(true)}
            className="rounded-full border border-ivory/15 px-4 py-2 text-[10px] tracking-[0.16em] text-soft uppercase"
          >
            Stealth
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-ivory/15 px-4 py-2 text-[10px] tracking-[0.16em] text-muted uppercase"
            >
              Minimize
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function secondsRefSafe(n: number) {
  return n
}
