'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'
import { scrollState } from '@/lib/scrollState'

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const { introDone, setScrollY, setScrollProgress } = useApp()
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!introDone) {
      document.documentElement.classList.add('lenis-stopped')
      document.body.style.overflow = 'hidden'
      return () => {
        document.documentElement.classList.remove('lenis-stopped')
        document.body.style.overflow = ''
      }
    }

    document.body.style.overflow = ''

    const publish = (y: number) => {
      scrollState.y = y
      setScrollY(y)
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      )
      const progress = Math.min(1, Math.max(0, y / max))
      scrollState.progress = progress
      setScrollProgress(progress)
    }

    if (reduced) {
      const onScroll = () => publish(window.scrollY)
      onScroll()
      window.addEventListener('scroll', onScroll, { passive: true })
      return () => window.removeEventListener('scroll', onScroll)
    }

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    })

    lenis.on('scroll', (e: { scroll: number }) => {
      publish(e.scroll)
    })

    let rafId = 0
    const raf = (time: number) => {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    document.documentElement.classList.add('lenis', 'lenis-smooth')
    publish(window.scrollY)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
      document.documentElement.classList.remove('lenis', 'lenis-smooth')
    }
  }, [introDone, reduced, setScrollProgress, setScrollY])

  return <>{children}</>
}
