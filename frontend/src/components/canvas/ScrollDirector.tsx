'use client'

import { useEffect, useRef } from 'react'
import { useApp } from '@/components/providers/AppProvider'

/** Section whoosh cues from Lenis-synced scroll progress */
export function ScrollDirector() {
  const { introDone, scrollProgress, playWhoosh } = useApp()
  const lastBand = useRef(-1)

  useEffect(() => {
    if (!introDone) return
    const band = Math.floor(scrollProgress * 7)
    if (band !== lastBand.current && band > lastBand.current) {
      lastBand.current = band
      playWhoosh()
    }
  }, [introDone, playWhoosh, scrollProgress])

  return null
}
