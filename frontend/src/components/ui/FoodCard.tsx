'use client'

import Image from 'next/image'
import { useState } from 'react'
import { motion } from 'framer-motion'
import type { MenuItem } from '@/lib/constants'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'

export function FoodCard({ item, index }: { item: MenuItem; index: number }) {
  const reduced = useReducedMotion()
  const { addToCart, favorites, toggleFavorite, playWhoosh, playClick } = useApp()
  const [added, setAdded] = useState(false)
  const fav = favorites.has(item.id)

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-5%' }}
      transition={{
        duration: 0.45,
        delay: Math.min(index % 8, 6) * 0.03,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="group relative overflow-hidden rounded-[1.25rem] border border-ivory/8 bg-panel/80 shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition-transform duration-300 hover:-translate-y-1"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <Image
          src={item.img}
          alt={item.name}
          fill
          sizes="(max-width:768px) 50vw, 20vw"
          loading="lazy"
          quality={85}
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-void via-void/25 to-transparent" />

        <button
          type="button"
          aria-label="Favourite"
          onClick={() => toggleFavorite(item.id)}
          className={`absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-ivory/15 bg-void/50 text-sm ${
            fav ? 'text-gold' : 'text-ivory/70'
          }`}
        >
          {fav ? '★' : '☆'}
        </button>

        {item.chefPick && (
          <span className="absolute top-3 left-3 rounded-full border border-gold/30 bg-gold/15 px-2.5 py-1 text-[9px] tracking-[0.18em] text-gold uppercase">
            Chef
          </span>
        )}
      </div>

      <div className="relative -mt-14 space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg leading-tight text-ivory">{item.name}</h3>
          <span className="font-display text-base text-gold-soft">${item.price.toFixed(0)}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-[9px] tracking-[0.12em] text-soft/70 uppercase">
          <span>★ {item.rating}</span>
          <span>{item.time}m</span>
          <span>{item.calories} kcal</span>
        </div>

        <button
          type="button"
          onClick={() => {
            addToCart(item)
            playWhoosh()
            playClick()
            setAdded(true)
            setTimeout(() => setAdded(false), 900)
          }}
          className="mt-2 flex w-full items-center justify-center rounded-full bg-ivory py-2.5 text-[10px] tracking-[0.2em] text-void uppercase active:scale-[0.98]"
        >
          {added ? 'Added' : 'Add'}
        </button>
      </div>
    </motion.div>
  )
}
