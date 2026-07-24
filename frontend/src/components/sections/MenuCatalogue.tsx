'use client'

import { useMemo, useState } from 'react'
import { CATEGORIES, MENU } from '@/lib/constants'
import { useApp } from '@/components/providers/AppProvider'
import { FoodCard } from '@/components/ui/FoodCard'
import { Reveal } from '@/components/ui/Reveal'
import { MagneticButton } from '@/components/ui/Magnetic'

export function MenuCatalogue() {
  const { category, query } = useApp()
  const [limit, setLimit] = useState(12)

  const filtered = useMemo(() => {
    return MENU.filter((item) => {
      const catOk = category === 'all' || item.category === category
      const q = query.trim().toLowerCase()
      const qOk =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.category.includes(q)
      return catOk && qOk
    })
  }, [category, query])

  const visible = filtered.slice(0, limit)
  const catLabel =
    category === 'all'
      ? 'Full catalogue'
      : CATEGORIES.find((c) => c.id === category)?.label ?? 'Menu'

  return (
    <section id="menu" className="relative z-10 py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mb-12 max-w-2xl">
          <Reveal>
            <p className="mb-4 text-[10px] tracking-[0.35em] text-gold uppercase">
              Menu
            </p>
          </Reveal>
          <h2 className="font-display text-4xl text-ivory md:text-5xl">{catLabel}</h2>
          <p className="mt-3 text-sm text-soft/70">{filtered.length} items</p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
          {visible.map((item, i) => (
            <FoodCard key={item.id} item={item} index={i} />
          ))}
        </div>

        {limit < filtered.length && (
          <div className="mt-12 flex justify-center">
            <MagneticButton
              strength={0.35}
              onClick={() => setLimit((n) => n + 12)}
              className="rounded-full border border-ivory/20 px-8 py-3 text-[10px] tracking-[0.24em] text-ivory uppercase"
            >
              Load more · {filtered.length - limit} remaining
            </MagneticButton>
          </div>
        )}
      </div>
    </section>
  )
}
