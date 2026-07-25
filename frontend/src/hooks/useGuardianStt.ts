'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/lib/constants'

export type GuardianListenState = 'starting' | 'listening' | 'unsupported' | 'error' | 'gemini'

export type TranscriptLine = {
  text: string
  t_sec: number
  final?: boolean
  source?: string
}

type Opts = {
  caseId: string
  token: string
  enabled?: boolean
  onLine: (line: TranscriptLine) => void
  onListenState?: (s: GuardianListenState) => void
  onAudioStatus?: (s: { recording: boolean; chunks: number; lastUploadOk: boolean; error?: string }) => void
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

/**
 * Evidence-first MediaRecorder + Chrome Web Speech.
 * Never tears down the recorder when STT errors (that was wiping admin audio).
 * Pushes live snapshots every ~8s so admin can play without waiting for Save.
 */
export function useGuardianStt({
  caseId,
  token,
  enabled = true,
  onLine,
  onListenState,
  onAudioStatus,
}: Opts) {
  const [listenState, setListenState] = useState<GuardianListenState>('starting')
  const [isRecording, setIsRecording] = useState(false)
  const secondsRef = useRef(0)
  const onLineRef = useRef(onLine)
  const onStateRef = useRef(onListenState)
  const onAudioRef = useRef(onAudioStatus)
  const lastPostedRef = useRef('')
  const browserOkRef = useRef(false)
  const lastBrowserAtRef = useRef(0)
  const seqRef = useRef(0)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const allChunksRef = useRef<Blob[]>([])
  const snapshotBusyRef = useRef(false)

  useEffect(() => {
    onLineRef.current = onLine
  }, [onLine])
  useEffect(() => {
    onStateRef.current = onListenState
  }, [onListenState])
  useEffect(() => {
    onAudioRef.current = onAudioStatus
  }, [onAudioStatus])

  const setState = useCallback((s: GuardianListenState) => {
    setListenState(s)
    onStateRef.current?.(s)
  }, [])

  const emitAudioStatus = useCallback((extra?: { lastUploadOk?: boolean; error?: string }) => {
    onAudioRef.current?.({
      recording: !!mediaRef.current && mediaRef.current.state !== 'inactive',
      chunks: allChunksRef.current.length,
      lastUploadOk: extra?.lastUploadOk ?? true,
      error: extra?.error,
    })
  }, [])

  const emitLine = useCallback((text: string, final: boolean, source: string) => {
    const cleaned = text.trim()
    if (!cleaned) return
    if (!final && cleaned.length < 3) return
    if (cleaned === lastPostedRef.current) return
    lastPostedRef.current = cleaned
    onLineRef.current({
      text: cleaned,
      t_sec: secondsRef.current,
      final,
      source,
    })
  }, [])

  const tickSeconds = useCallback((n: number) => {
    secondsRef.current = n
  }, [])

  const getRecordingBlob = useCallback(() => {
    const parts = allChunksRef.current
    if (!parts.length) return null
    return new Blob(parts, { type: parts[0]?.type || 'audio/webm' })
  }, [])

  const pushLiveSnapshot = useCallback(async () => {
    if (snapshotBusyRef.current) return false
    const blob = getRecordingBlob()
    if (!blob || blob.size < 500) return false
    snapshotBusyRef.current = true
    try {
      const content_b64 = await blobToB64(blob)
      const res = await fetch(`${API_BASE}/guardian/${caseId}/evidence/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          filename: 'guardian-live.webm',
          content_b64,
          duration_sec: secondsRef.current,
          confirm_upload: true,
          live_snapshot: true,
        }),
      })
      const ok = res.ok
      emitAudioStatus({ lastUploadOk: ok, error: ok ? undefined : `Upload failed (${res.status})` })
      return ok
    } catch {
      emitAudioStatus({ lastUploadOk: false, error: 'Could not upload audio' })
      return false
    } finally {
      snapshotBusyRef.current = false
    }
  }, [caseId, token, getRecordingBlob, emitAudioStatus])

  useEffect(() => {
    if (!enabled) return
    let dead = false
    let speech: {
      continuous: boolean
      interimResults: boolean
      lang: string
      onresult: ((ev: SpeechRecEvent) => void) | null
      onerror: ((ev: { error?: string }) => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
      abort?: () => void
    } | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    let pending = ''
    let finalsAccum = ''
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let speechTimer: ReturnType<typeof setTimeout> | null = null
    let snapshotTimer: ReturnType<typeof setInterval> | null = null

    type SpeechRecEvent = {
      resultIndex: number
      results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
    }

    const w = window as unknown as {
      SpeechRecognition?: new () => NonNullable<typeof speech>
      webkitSpeechRecognition?: new () => NonNullable<typeof speech>
    }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition

    const flushPending = (final: boolean) => {
      if (debounce) {
        clearTimeout(debounce)
        debounce = null
      }
      if (pending.trim()) {
        browserOkRef.current = true
        lastBrowserAtRef.current = Date.now()
        emitLine(pending, final, 'browser')
      }
    }

    const uploadChunk = async (blob: Blob, forceStt: boolean) => {
      if (dead || !blob.size) return
      const seq = seqRef.current++
      try {
        const content_b64 = await blobToB64(blob)
        const res = await fetch(`${API_BASE}/guardian/${caseId}/audio-chunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            seq,
            content_b64,
            mime: blob.type || 'audio/webm',
            t_sec: secondsRef.current,
            force_stt: forceStt,
            stt: forceStt ? 'browser_failed' : browserOkRef.current ? 'browser_ok' : 'pending',
          }),
        })
        emitAudioStatus({ lastUploadOk: res.ok, error: res.ok ? undefined : `Chunk ${res.status}` })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const text = typeof data.transcript === 'string' ? data.transcript.trim() : ''
        if (text && forceStt) {
          setState('gemini')
          emitLine(text, true, 'gemini')
        }
      } catch {
        emitAudioStatus({ lastUploadOk: false, error: 'Chunk upload failed' })
      }
    }

    const startRecorder = async () => {
      if (dead || mediaRef.current) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (dead) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : ''
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
        allChunksRef.current = []
        rec.ondataavailable = (e) => {
          if (!e.data.size) return
          allChunksRef.current.push(e.data)
          emitAudioStatus({ lastUploadOk: true })
          const needGemini =
            !Ctor || !browserOkRef.current || Date.now() - lastBrowserAtRef.current > 10000
          void uploadChunk(e.data, needGemini)
        }
        rec.onerror = () => {
          emitAudioStatus({ lastUploadOk: false, error: 'Recorder error' })
        }
        mediaRef.current = rec
        rec.start(2500)
        setIsRecording(true)
        emitAudioStatus({ lastUploadOk: true })
      } catch {
        emitAudioStatus({ lastUploadOk: false, error: 'Microphone blocked for recording' })
        setIsRecording(false)
      }
    }

    const startSpeech = () => {
      if (!Ctor || dead) {
        if (!Ctor) setState('unsupported')
        return
      }
      try {
        speech?.abort?.()
      } catch {
        /* ignore */
      }
      try {
        speech?.stop()
      } catch {
        /* ignore */
      }

      const rec = new Ctor()
      speech = rec
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'

      rec.onresult = (ev: SpeechRecEvent) => {
        if (dead) return
        setState('listening')
        browserOkRef.current = true
        lastBrowserAtRef.current = Date.now()
        let interim = ''
        let hasFinal = false
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const piece = ev.results[i]
          const t = piece[0]?.transcript || ''
          if (piece.isFinal) {
            finalsAccum += `${t} `
            hasFinal = true
          } else interim += t
        }
        pending = `${finalsAccum}${interim}`.trim()
        if (debounce) clearTimeout(debounce)
        if (hasFinal) flushPending(true)
        else debounce = setTimeout(() => flushPending(false), 400)
      }

      rec.onerror = (ev) => {
        if (dead) return
        const err = ev.error || ''
        if (err === 'no-speech' || err === 'aborted') return
        setState('error')
        // Do NOT stop MediaRecorder — evidence must keep flowing to admin
        if (restartTimer) clearTimeout(restartTimer)
        restartTimer = setTimeout(() => {
          if (!dead) startSpeech()
        }, 900)
      }

      rec.onend = () => {
        if (dead) return
        restartTimer = setTimeout(() => {
          if (dead) return
          try {
            rec.start()
            setState('listening')
          } catch {
            startSpeech()
          }
        }, 250)
      }

      try {
        rec.start()
        setState('listening')
      } catch {
        setState('error')
        restartTimer = setTimeout(() => {
          if (!dead) startSpeech()
        }, 800)
      }
    }

    // Evidence recorder FIRST, then STT — admin audio is non-negotiable
    setState('starting')
    void startRecorder().then(() => {
      if (dead) return
      speechTimer = setTimeout(() => {
        if (!dead) startSpeech()
      }, 400)
    })

    snapshotTimer = setInterval(() => {
      if (!dead) void pushLiveSnapshot()
    }, 8000)

    return () => {
      dead = true
      if (debounce) clearTimeout(debounce)
      if (restartTimer) clearTimeout(restartTimer)
      if (speechTimer) clearTimeout(speechTimer)
      if (snapshotTimer) clearInterval(snapshotTimer)
      try {
        speech?.abort?.()
        speech?.stop()
      } catch {
        /* ignore */
      }
      try {
        if (mediaRef.current && mediaRef.current.state !== 'inactive') {
          mediaRef.current.stop()
        }
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      mediaRef.current = null
      setIsRecording(false)
    }
  }, [caseId, token, enabled, emitLine, setState, emitAudioStatus, pushLiveSnapshot])

  const stopRecording = useCallback(() => {
    try {
      if (mediaRef.current && mediaRef.current.state !== 'inactive') {
        mediaRef.current.requestData?.()
        mediaRef.current.stop()
      }
    } catch {
      /* ignore */
    }
    setIsRecording(false)
  }, [])

  return {
    listenState,
    isRecording,
    tickSeconds,
    getRecordingBlob,
    stopRecording,
    pushLiveSnapshot,
    lastPostedRef,
  }
}
