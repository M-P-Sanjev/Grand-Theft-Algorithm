'use client'

import { useEffect, useRef } from 'react'
import { useApp } from '@/components/providers/AppProvider'

function createNoiseBuffer(ctx: AudioContext, seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

export function AudioEngine() {
  const { audioEnabled, registerAudio } = useApp()
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const enabledRef = useRef(false)

  useEffect(() => {
    enabledRef.current = audioEnabled
    const master = masterRef.current
    if (!master) return
    master.gain.cancelScheduledValues(master.context.currentTime)
    master.gain.linearRampToValueAtTime(
      audioEnabled ? 0.15 : 0,
      master.context.currentTime + 0.7,
    )
  }, [audioEnabled])

  useEffect(() => {
    const ctx = new AudioContext()
    ctxRef.current = ctx
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    masterRef.current = master

    const noise = ctx.createBufferSource()
    noise.buffer = createNoiseBuffer(ctx, 3)
    noise.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 380
    const gain = ctx.createGain()
    gain.gain.value = 0.1
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    noise.start()

    const blip = (freq: number, dur: number, type: OscillatorType, vol: number) => {
      if (!enabledRef.current || !masterRef.current) return
      void ctx.resume()
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.value = vol
      osc.connect(g)
      g.connect(masterRef.current)
      const t = ctx.currentTime
      g.gain.setValueAtTime(vol, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.start(t)
      osc.stop(t + dur + 0.02)
    }

    registerAudio({
      whoosh: () => {
        if (!enabledRef.current || !masterRef.current) return
        void ctx.resume()
        const src = ctx.createBufferSource()
        src.buffer = createNoiseBuffer(ctx, 0.3)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = 1100
        const g = ctx.createGain()
        g.gain.value = 0.07
        src.connect(f)
        f.connect(g)
        g.connect(masterRef.current)
        const t = ctx.currentTime
        f.frequency.exponentialRampToValueAtTime(200, t + 0.28)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
        src.start()
        src.stop(t + 0.32)
      },
      click: () => blip(920, 0.05, 'triangle', 0.045),
      chime: () => {
        blip(523.25, 0.3, 'sine', 0.05)
        setTimeout(() => blip(659.25, 0.4, 'sine', 0.04), 70)
        setTimeout(() => blip(783.99, 0.5, 'sine', 0.035), 140)
      },
      hit: () => {
        blip(48, 0.45, 'sine', 0.11)
        blip(96, 0.25, 'triangle', 0.05)
      },
      pop: () => {
        blip(640, 0.08, 'sine', 0.06)
        blip(980, 0.1, 'triangle', 0.04)
      },
      plate: () => blip(340, 0.12, 'triangle', 0.035),
    })

    return () => {
      noise.stop()
      void ctx.close()
    }
  }, [registerAudio])

  return null
}
