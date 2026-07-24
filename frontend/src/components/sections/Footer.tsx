'use client'

import { SITE, NAV } from '@/lib/constants'

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-ivory/8 py-12">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-6 md:flex-row md:items-center md:px-10">
        <p className="font-display text-2xl tracking-[0.14em] text-ivory">{SITE.name}</p>
        <nav className="flex gap-8">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[10px] tracking-[0.22em] text-muted uppercase hover:text-gold"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <p className="text-[10px] tracking-[0.18em] text-muted uppercase">
          © {new Date().getFullYear()} {SITE.name}
        </p>
      </div>
    </footer>
  )
}
