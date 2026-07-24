'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'

gsap.registerPlugin(ScrollTrigger)

type Props = {
  text: string
  as?: 'h1' | 'h2' | 'h3' | 'p'
  className?: string
  delay?: number
  trigger?: 'load' | 'scroll'
}

export function LetterReveal({
  text,
  as: Tag = 'h1',
  className = '',
  delay = 0,
  trigger = 'load',
}: Props) {
  const ref = useRef<HTMLElement>(null)
  const { loadingDone } = useApp()
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!ref.current) return
    const letters = ref.current.querySelectorAll('.letter')

    if (reduced) {
      gsap.set(letters, { opacity: 1, y: 0, filter: 'blur(0px)' })
      return
    }

    if (trigger === 'load' && !loadingDone) return

    const ctx = gsap.context(() => {
      const anim = {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 0.9,
        stagger: 0.028,
        delay,
        ease: 'power3.out',
      }

      if (trigger === 'scroll') {
        gsap.fromTo(
          letters,
          { opacity: 0, y: 28, filter: 'blur(8px)' },
          {
            ...anim,
            scrollTrigger: {
              trigger: ref.current,
              start: 'top 82%',
            },
          },
        )
      } else {
        gsap.fromTo(
          letters,
          { opacity: 0, y: 28, filter: 'blur(8px)' },
          anim,
        )
      }
    }, ref)

    return () => ctx.revert()
  }, [delay, loadingDone, reduced, text, trigger])

  const chars = Array.from(text)

  return (
    <Tag ref={ref as never} className={className} aria-label={text}>
      {chars.map((ch, i) => (
        <span key={`${ch}-${i}`} className="inline-block overflow-hidden align-bottom">
          <span
            className="letter inline-block will-change-transform"
            style={{ opacity: 0 }}
          >
            {ch === ' ' ? '\u00A0' : ch}
          </span>
        </span>
      ))}
    </Tag>
  )
}
