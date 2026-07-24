'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '@/components/providers/AppProvider'
import { SITE } from '@/lib/constants'

export function LoadingCinematic() {
  const { setLoadingDone, setIntroDone, playHit } = useApp()
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'load' | 'flash' | 'done'>('load')
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    let frame = 0
    let value = 0
    const tick = () => {
      value += Math.random() * 3.6 + 1.2
      if (value >= 100) {
        value = 100
        setProgress(100)
        setPhase('flash')
        playHit()
        setTimeout(() => {
          setLoadingDone(true)
          setPhase('done')
        }, 450)
        setTimeout(() => {
          setIntroDone(true)
          setVisible(false)
        }, 1100)
        return
      }
      setProgress(Math.floor(value))
      frame = window.setTimeout(tick, 28 + Math.random() * 38)
    }
    frame = window.setTimeout(tick, 250)
    return () => window.clearTimeout(frame)
  }, [playHit, setLoadingDone, setIntroDone])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-void"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => (
              <motion.span
                key={i}
                className="absolute h-0.5 w-0.5 rounded-full bg-gold/55"
                style={{ left: `${(i * 19) % 100}%`, top: `${(i * 27) % 100}%` }}
                animate={{ y: [0, -28, 0], opacity: [0.1, 0.7, 0.1] }}
                transition={{ duration: 4 + (i % 5), repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </div>

          {/* skyline silhouette */}
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-40 items-end justify-center gap-1 opacity-40"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: phase === 'load' ? 0.35 : 0, y: 0 }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {[40, 70, 55, 90, 48, 75, 60, 85, 45, 68, 52, 80].map((h, i) => (
              <div
                key={i}
                className="w-6 bg-gradient-to-t from-gold/35 to-transparent"
                style={{ height: `${h}%` }}
              />
            ))}
          </motion.div>

          {/* scooter silhouette */}
          <motion.div
            className="absolute bottom-[22%] text-[11px] tracking-[0.5em] text-gold/45 uppercase"
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          >
            ▢—○  rooftop service online
          </motion.div>

          <motion.p
            className="font-display relative z-10 text-[16vw] leading-none tracking-[0.18em] text-ivory md:text-[7.5rem]"
            initial={{ opacity: 0, scale: 0.9, filter: 'blur(14px)' }}
            animate={{
              opacity: phase === 'done' ? 0 : 1,
              scale: phase === 'flash' ? 1.05 : 1,
              filter: 'blur(0px)',
            }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {SITE.name}
          </motion.p>

          <motion.p
            className="relative z-10 mt-5 text-[10px] tracking-[0.42em] text-muted uppercase"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === 'load' ? 1 : 0 }}
          >
            Warming the table
          </motion.p>

          <div className="relative z-10 mt-10 h-px w-52 overflow-hidden bg-ivory/10">
            <div className="h-full bg-gradient-to-r from-amber to-gold" style={{ width: `${progress}%` }} />
          </div>
          <p className="relative z-10 mt-4 text-[10px] tracking-[0.35em] text-muted uppercase">
            {String(progress).padStart(3, '0')}
          </p>

          <AnimatePresence>
            {phase === 'flash' && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-20 bg-[#ffc090]"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.4, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
