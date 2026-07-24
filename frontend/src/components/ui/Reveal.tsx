'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'

gsap.registerPlugin(ScrollTrigger)

type Props = {
  children: React.ReactNode
  className?: string
  delay?: number
  y?: number
  once?: boolean
}

export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 40,
  once = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { loadingDone } = useApp()
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!ref.current || !loadingDone) return
    if (reduced) {
      gsap.set(ref.current, { opacity: 1, y: 0, filter: 'blur(0px)' })
      return
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y, filter: 'blur(6px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 1.2,
          delay,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top 88%',
            toggleActions: once ? 'play none none none' : 'play none none reverse',
          },
        },
      )
    }, ref)

    return () => ctx.revert()
  }, [delay, loadingDone, once, reduced, y])

  return (
    <div ref={ref} className={className} style={{ opacity: reduced ? 1 : 0 }}>
      {children}
    </div>
  )
}
