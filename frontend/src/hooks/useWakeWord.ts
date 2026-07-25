'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const WAKE_RE = /\bsafra\b(?:\s+(?:help(?:\s+me)?|please|emergency))?/i

type SpeechRec = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> }) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec
    webkitSpeechRecognition?: new () => SpeechRec
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.04
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    setTimeout(() => {
      o.stop()
      void ctx.close()
    }, 120)
  } catch {
    /* ignore */
  }
}

export function useWakeWord(opts: {
  enabled: boolean
  onWake: (phrase: string) => void
}) {
  const { enabled, onWake } = opts
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const onWakeRef = useRef(onWake)
  onWakeRef.current = onWake
  const coolRef = useRef(0)

  const trigger = useCallback((phrase: string) => {
    const now = Date.now()
    if (now - coolRef.current < 8000) return
    coolRef.current = now
    try {
      navigator.vibrate?.(200)
    } catch {
      /* ignore */
    }
    beep()
    onWakeRef.current(phrase)
  }, [])

  useEffect(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      setSupported(false)
      return
    }
    if (!enabled) {
      setListening(false)
      return
    }

    let stopped = false
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (ev) => {
      const parts: string[] = []
      for (let i = 0; i < ev.results.length; i++) {
        parts.push(ev.results[i][0].transcript)
      }
      const text = parts.join(' ').trim()
      if (WAKE_RE.test(text)) trigger(text)
    }
    rec.onerror = () => {
      setListening(false)
    }
    rec.onend = () => {
      setListening(false)
      if (!stopped && enabled) {
        try {
          rec.start()
          setListening(true)
        } catch {
          /* ignore */
        }
      }
    }
    try {
      rec.start()
      setListening(true)
      setSupported(true)
    } catch {
      setSupported(false)
    }

    return () => {
      stopped = true
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }, [enabled, trigger])

  return { listening, supported, triggerManually: () => trigger('Safra help me') }
}
