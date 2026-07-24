'use client'

import { useEffect } from 'react'
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'

/** Lightweight spotlight — disabled after hero for FPS */
export function CursorSpotlight() {
  const reduced = useReducedMotion()
  const { scrollProgress, introDone } = useApp()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const background = useMotionTemplate`radial-gradient(420px circle at ${x}px ${y}px, rgba(255,176,96,0.07), transparent 55%)`

  useEffect(() => {
    if (reduced || !introDone || scrollProgress > 0.2) return
    const onMove = (e: MouseEvent) => {
      x.set(e.clientX)
      y.set(e.clientY)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [reduced, introDone, scrollProgress, x, y])

  if (reduced || !introDone || scrollProgress > 0.2) return null

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80] mix-blend-screen max-md:hidden"
      style={{ background }}
    />
  )
}
