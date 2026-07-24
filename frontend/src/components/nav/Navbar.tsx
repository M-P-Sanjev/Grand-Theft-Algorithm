'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Magnetic } from '@/components/ui/Magnetic'
import { NAV, SITE } from '@/lib/constants'
import { useApp } from '@/components/providers/AppProvider'

export function Navbar() {
  const { introDone, cart, scrollY } = useApp()
  const [open, setOpen] = useState(false)
  const scrolled = scrollY > 40

  if (!introDone) return null

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled ? 'glass py-3' : 'bg-transparent py-5'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 md:px-10">
          <a href="#top" className="font-display text-2xl tracking-[0.16em] text-ivory md:text-3xl">
            {SITE.name}
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[10px] tracking-[0.28em] text-soft/80 uppercase transition-colors hover:text-gold"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Magnetic strength={0.3}>
            <a
              href="#order"
              className="rounded-full border border-gold/30 bg-gold/10 px-5 py-2 text-[10px] tracking-[0.22em] text-gold uppercase"
            >
              Cart{cart.length > 0 ? ` · ${cart.length}` : ''}
            </a>
          </Magnetic>

          <button
            type="button"
            className="text-[10px] tracking-[0.28em] text-soft uppercase md:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-void/95 backdrop-blur-2xl md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="font-display text-4xl tracking-[0.08em] text-ivory"
              >
                {item.label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
