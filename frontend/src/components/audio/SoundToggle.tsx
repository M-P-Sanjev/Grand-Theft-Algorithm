'use client'

import { motion } from 'framer-motion'
import { useApp } from '@/components/providers/AppProvider'

export function SoundToggle() {
  const { audioEnabled, setAudioEnabled, introDone, playClick } = useApp()
  if (!introDone) return null

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed right-5 bottom-5 z-[95] rounded-full border border-ivory/15 bg-void/70 px-4 py-2 text-[9px] tracking-[0.28em] text-soft uppercase backdrop-blur-md md:right-8 md:bottom-8"
      onClick={() => {
        playClick()
        setAudioEnabled(!audioEnabled)
      }}
    >
      {audioEnabled ? 'Sound on' : 'Sound off'}
    </motion.button>
  )
}
