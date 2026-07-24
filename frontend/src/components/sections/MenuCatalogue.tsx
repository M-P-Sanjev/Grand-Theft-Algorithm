'use client'

import { useMemo } from 'react'
import { CATEGORIES, MENU } from '@/lib/constants'
import { useApp } from '@/components/providers/AppProvider'
import { FoodCard } from '@/components/ui/FoodCard'
import { Reveal } from '@/components/ui/Reveal'

export function MenuCatalogue() {
  const { category, query } = useApp()

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

  const catLabel =
    category === 'all'
      ? 'Signature menu'
      : CATEGORIES.find((c) => c.id === category)?.label ?? 'Menu'

  const catMeta =
    category === 'all'
      ? `${MENU.length} carefully chosen dishes`
      : `${filtered.length} ${catLabel.toLowerCase()} ${filtered.length === 1 ? 'dish' : 'dishes'}`

  return (
    <section id="menu" className="relative z-10 py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="mb-12 max-w-2xl">
          <Reveal>
            <p className="mb-4 text-[10px] tracking-[0.35em] text-gold uppercase">
              Curated kitchen
            </p>
          </Reveal>
          <h2 className="font-display text-4xl text-ivory md:text-5xl">{catLabel}</h2>
          <p className="mt-3 text-sm text-soft/70">{catMeta}</p>
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-[1.25rem] border border-ivory/10 px-6 py-10 text-center text-sm text-muted">
            No dishes match that search. Try another word, or browse All.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
            {filtered.map((item, i) => (
              <FoodCard key={item.id} item={item} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
