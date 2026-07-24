'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Reveal } from '@/components/ui/Reveal'
import { LetterReveal } from '@/components/ui/LetterReveal'

const PINS = [
  { x: 22, y: 38, label: 'You' },
  { x: 58, y: 42, label: 'Kitchen' },
  { x: 74, y: 28, label: 'Hub B' },
  { x: 40, y: 62, label: 'Drop' },
]

export function DeliveryMap() {
  const [t, setT] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setT((v) => v + 1), 40)
    return () => window.clearInterval(id)
  }, [])

  const bikeX = 20 + ((t * 0.35) % 60)
  const bikeY = 45 + Math.sin(t * 0.05) * 8
  const droneX = 70 - ((t * 0.25) % 50)
  const droneY = 25 + Math.cos(t * 0.04) * 6

  return (
    <section id="map" className="relative z-10 py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal>
          <p className="mb-4 text-[10px] tracking-[0.35em] text-gold uppercase">Live city</p>
        </Reveal>
        <LetterReveal
          text="The network never sleeps."
          as="h2"
          trigger="scroll"
          className="font-display max-w-3xl text-5xl text-ivory md:text-6xl"
        />

        <Reveal delay={0.15} className="mt-12">
          <div className="glass relative aspect-[16/10] overflow-hidden rounded-[2rem] md:aspect-[21/10]">
            {/* grid city */}
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(212,165,116,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(212,165,116,0.08) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,rgba(255,176,96,0.12),transparent_50%),radial-gradient(ellipse_at_70%_60%,rgba(212,165,116,0.1),transparent_45%)]" />

            {/* route */}
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path
                d="M22 38 C 35 30, 48 55, 58 42 S 70 35, 74 28"
                fill="none"
                stroke="rgba(212,165,116,0.45)"
                strokeWidth="0.4"
                strokeDasharray="1.2 1.6"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {PINS.map((p) => (
              <div
                key={p.label}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <span className="block h-3 w-3 rounded-full bg-gold shadow-[0_0_16px_rgba(232,194,122,0.8)]" />
                <span className="mt-1 block whitespace-nowrap text-[9px] tracking-[0.2em] text-soft uppercase">
                  {p.label}
                </span>
              </div>
            ))}

            <motion.div
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/40 bg-gold/15 px-2 py-1 text-[9px] tracking-[0.16em] text-gold uppercase"
              style={{ left: `${bikeX}%`, top: `${bikeY}%` }}
            >
              Bike
            </motion.div>
            <motion.div
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/40 bg-gold/15 px-2 py-1 text-[9px] tracking-[0.16em] text-gold uppercase"
              style={{ left: `${droneX}%`, top: `${droneY}%` }}
            >
              Drone
            </motion.div>

            <div className="absolute right-5 bottom-5 left-5 flex flex-wrap gap-4 text-[10px] tracking-[0.18em] text-soft/80 uppercase md:justify-end">
              <span>Traffic · light</span>
              <span>Weather · clear</span>
              <span>Nodes · 128 online</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
