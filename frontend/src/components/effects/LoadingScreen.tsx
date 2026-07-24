'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '@/components/providers/AppProvider'
import { SITE } from '@/lib/constants'

export function LoadingScreen() {
  const { setLoadingDone } = useApp()
  const [progress, setProgress] = useState(0)
  const [exit, setExit] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    let frame = 0
    let value = 0
    const tick = () => {
      value += Math.random() * 4.5 + 1.4
      if (value >= 100) {
        value = 100
        setProgress(100)
        setTimeout(() => setExit(true), 380)
        setTimeout(() => {
          setVisible(false)
          setLoadingDone(true)
        }, 1100)
        return
      }
      setProgress(Math.floor(value))
      frame = window.setTimeout(tick, 26 + Math.random() * 36)
    }
    frame = window.setTimeout(tick, 180)
    return () => window.clearTimeout(frame)
  }, [setLoadingDone])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-void"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.p
            className="font-display text-[12vw] leading-none tracking-[0.14em] text-ivory md:text-[6rem]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: exit ? 0 : 1, y: exit ? -16 : 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          >
            {SITE.name}
          </motion.p>
          <motion.div
            className="mt-10 h-px w-44 overflow-hidden bg-ivory/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="h-full bg-gold" style={{ width: `${progress}%` }} />
          </motion.div>
          <p className="mt-4 text-[10px] tracking-[0.4em] text-muted uppercase">
            {String(progress).padStart(3, '0')}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
