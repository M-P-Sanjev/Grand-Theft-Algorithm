'use client'

import Image from 'next/image'
import { useState } from 'react'
import { motion } from 'framer-motion'
import type { MenuItem } from '@/lib/constants'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'
import { PassportModal } from '@/components/secret/PassportModal'

export function FoodCard({ item, index }: { item: MenuItem; index: number }) {
  const reduced = useReducedMotion()
  const { addToCart, playWhoosh, playClick } = useApp()
  const [added, setAdded] = useState(false)
  const [passportOpen, setPassportOpen] = useState(false)
  const isSecret = Boolean(item.secretEntry)

  return (
    <>
      <motion.article
        initial={reduced ? false : { opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-5%' }}
        transition={{
          duration: 0.45,
          delay: Math.min(index % 8, 5) * 0.04,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="group relative flex flex-col overflow-hidden rounded-[1.35rem] border border-ivory/8 bg-panel/85 shadow-[0_16px_48px_rgba(0,0,0,0.38)] transition-transform duration-300 hover:-translate-y-1"
      >
        <div className="relative aspect-[4/5] overflow-hidden">
          <Image
            src={item.img}
            alt={item.name}
            fill
            sizes="(max-width:768px) 50vw, 25vw"
            loading="lazy"
            quality={85}
            className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-void via-void/20 to-transparent opacity-90" />
          {item.chefPick && !isSecret && (
            <span className="absolute top-3 left-3 rounded-full border border-gold/35 bg-void/55 px-2.5 py-1 text-[9px] tracking-[0.18em] text-gold uppercase backdrop-blur-sm">
              Signature
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-[1.15rem] leading-tight text-ivory">
              {item.name}
            </h3>
            <span className="shrink-0 font-display text-base text-gold-soft">
              ${item.price.toFixed(0)}
            </span>
          </div>

          <p className="line-clamp-2 text-[12px] leading-relaxed text-soft/75">
            {item.desc}
          </p>

          <div className="mt-auto flex items-center gap-3 pt-1 text-[10px] tracking-[0.14em] text-soft/65 uppercase">
            <span>★ {item.rating.toFixed(1)}</span>
            <span className="h-1 w-1 rounded-full bg-ivory/25" />
            <span>{item.time} min</span>
          </div>

          <button
            type="button"
            onClick={() => {
              playClick()
              if (isSecret) {
                setPassportOpen(true)
                return
              }
              addToCart(item)
              playWhoosh()
              setAdded(true)
              setTimeout(() => setAdded(false), 900)
            }}
            className="mt-2 flex w-full items-center justify-center rounded-full bg-ivory py-2.5 text-[10px] tracking-[0.22em] text-void uppercase transition active:scale-[0.98]"
          >
            {added && !isSecret ? 'Added' : 'Add to Cart'}
          </button>
        </div>
      </motion.article>

      {isSecret && (
        <PassportModal open={passportOpen} onClose={() => setPassportOpen(false)} />
      )}
    </>
  )
}
