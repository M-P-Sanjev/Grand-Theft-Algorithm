'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Reveal } from '@/components/ui/Reveal'
import { LetterReveal } from '@/components/ui/LetterReveal'

const SHOTS = [
  {
    src: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1600&q=90',
    label: 'Smash · charcoal brioche',
  },
  {
    src: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=1600&q=90',
    label: 'Tonkotsu · soft egg',
  },
  {
    src: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1600&q=90',
    label: 'City lights · delivery window',
  },
]

export function AtmosphereStrip() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })
  const y = useTransform(scrollYProgress, [0, 1], [40, -40])

  return (
    <section ref={ref} className="relative z-10 overflow-hidden py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal>
          <p className="mb-4 text-[10px] tracking-[0.35em] text-gold uppercase">
            Photographed, not rendered
          </p>
        </Reveal>
        <LetterReveal
          text="Real plates. Real light."
          as="h2"
          trigger="scroll"
          className="font-display max-w-2xl text-4xl text-ivory md:text-5xl"
        />

        <motion.div style={{ y }} className="mt-14 grid gap-4 md:grid-cols-3">
          {SHOTS.map((shot, i) => (
            <Reveal key={shot.src} delay={i * 0.08} y={36}>
              <figure className="group relative aspect-[3/4] overflow-hidden rounded-[1.25rem]">
                <Image
                  src={shot.src}
                  alt={shot.label}
                  fill
                  sizes="(max-width:768px) 100vw, 33vw"
                  quality={88}
                  className="object-cover transition-transform duration-[1.6s] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-void via-transparent to-transparent opacity-80" />
                <figcaption className="absolute bottom-5 left-5 text-[10px] tracking-[0.22em] text-soft uppercase">
                  {shot.label}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
