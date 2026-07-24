'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Magnetic } from '@/components/ui/Magnetic'
import { LetterReveal } from '@/components/ui/LetterReveal'
import { useApp } from '@/components/providers/AppProvider'
import { SITE } from '@/lib/constants'
import { useReducedMotion } from '@/lib/utils'

const ease = [0.22, 1, 0.36, 1] as const

/**
 * Scroll parallax driven by the hero’s position in the viewport
 * (works with Lenis; does not rely on position:sticky).
 */
export function HeroOverlay() {
  const { introDone, playWhoosh, cart } = useApp()
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const midRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const raf = useRef(0)

  useEffect(() => {
    const tick = () => {
      const section = sectionRef.current
      const bg = bgRef.current
      const mid = midRef.current
      const content = contentRef.current

      if (section && bg) {
        const rect = section.getBoundingClientRect()
        // How far the section has scrolled through the viewport (0 at top → 1 when leaving)
        const traveled = Math.max(0, -rect.top)
        const range = Math.max(1, rect.height)
        const p = Math.min(1, traveled / range)

        if (reduced) {
          bg.style.transform = 'translate3d(0,0,0) scale(1.05)'
          if (mid) mid.style.opacity = '1'
          if (content) {
            content.style.transform = 'translate3d(0,0,0)'
            content.style.opacity = '1'
          }
        } else {
          // Background moves slower than scroll → depth
          bg.style.transform = `translate3d(0, ${traveled * 0.55}px, 0) scale(${1.1 + p * 0.08})`
          if (mid) mid.style.opacity = String(0.85 + p * 0.15)
          // Copy drifts up slightly and fades as you leave the hero
          if (content) {
            content.style.transform = `translate3d(0, ${traveled * -0.25}px, 0)`
            content.style.opacity = String(Math.max(0, 1 - p * 1.15))
          }
        }
      }

      raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [reduced])

  return (
    <section
      id="top"
      ref={sectionRef}
      className="relative z-10 flex min-h-[100svh] items-end overflow-hidden pb-20 md:pb-28"
      aria-label="Safra hero"
    >
      <div
        ref={bgRef}
        className="pointer-events-none absolute inset-[-10%] will-change-transform"
        style={{ transform: 'translate3d(0,0,0) scale(1.08)' }}
      >
        <Image
          src="/themes/rooftop-night.png"
          alt="Safra food delivery"
          fill
          priority
          quality={92}
          sizes="100vw"
          className="object-cover object-[center_42%]"
          draggable={false}
        />
      </div>

      <div
        ref={midRef}
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-void via-void/55 to-void/35" />
        <div className="absolute inset-0 bg-gradient-to-r from-void/80 via-void/30 to-transparent" />
      </div>

      {introDone && (
        <div
          ref={contentRef}
          className="relative z-10 mx-auto w-full max-w-7xl px-6 will-change-transform md:px-10"
        >
          <motion.p
            className="mb-4 font-display text-3xl tracking-[0.14em] text-gold md:text-4xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease }}
          >
            {SITE.name}
          </motion.p>

          <LetterReveal
            text={SITE.tagline}
            as="h1"
            delay={0.1}
            className="font-display max-w-3xl text-[11vw] leading-[0.95] tracking-[-0.02em] text-ivory drop-shadow-[0_8px_40px_rgba(0,0,0,0.55)] md:text-[4.75rem]"
          />

          <motion.p
            className="mt-6 max-w-md text-base text-soft/90 md:text-lg"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.85, duration: 0.9, ease }}
          >
            {SITE.subheading}
          </motion.p>

          <motion.div
            className="mt-10 flex flex-wrap gap-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.05, duration: 0.9, ease }}
          >
            <Magnetic strength={0.35}>
              <a
                href="#menu"
                onMouseEnter={() => playWhoosh()}
                className="inline-flex rounded-full bg-ivory px-8 py-3.5 text-[10px] tracking-[0.28em] text-void uppercase"
              >
                Browse menu
              </a>
            </Magnetic>
            <Magnetic strength={0.35}>
              <a
                href="#order"
                onMouseEnter={() => playWhoosh()}
                className="inline-flex rounded-full border border-gold/40 bg-void/40 px-8 py-3.5 text-[10px] tracking-[0.28em] text-gold-soft uppercase backdrop-blur-md"
              >
                {cart.length > 0 ? `Cart (${cart.length})` : 'Checkout'}
              </a>
            </Magnetic>
          </motion.div>
        </div>
      )}
    </section>
  )
}
