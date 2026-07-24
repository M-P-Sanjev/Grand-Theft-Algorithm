'use client'

import { useMemo, useState } from 'react'
import { CATEGORIES } from '@/lib/constants'
import { useApp } from '@/components/providers/AppProvider'

export function SearchExperience() {
  const { query, setQuery, category, setCategory, playClick } = useApp()
  const [focused, setFocused] = useState(false)

  const chips = useMemo(() => CATEGORIES.slice(0, 10), [])

  return (
    <section id="search" className="relative z-10 py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-6 md:px-10">
        <div
          className={`glass relative rounded-full px-2 py-2 transition ${
            focused ? 'glow-gold' : ''
          }`}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search dishes…"
            className="w-full bg-transparent px-5 py-3.5 text-sm text-ivory outline-none placeholder:text-muted"
          />
        </div>

        <div className="mt-6 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => {
              setCategory('all')
              playClick()
            }}
            className={`shrink-0 rounded-full border px-4 py-2 text-[10px] tracking-[0.16em] uppercase transition ${
              category === 'all'
                ? 'border-gold/40 bg-gold/15 text-gold'
                : 'border-ivory/10 text-soft hover:border-ivory/25'
            }`}
          >
            All
          </button>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCategory(c.id)
                playClick()
              }}
              className={`shrink-0 rounded-full border px-4 py-2 text-[10px] tracking-[0.14em] uppercase transition ${
                category === c.id
                  ? 'border-gold/40 bg-gold/15 text-gold'
                  : 'border-ivory/10 text-soft hover:border-ivory/25'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
