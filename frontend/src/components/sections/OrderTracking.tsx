'use client'

import { useMemo, useState } from 'react'
import { Reveal } from '@/components/ui/Reveal'
import { useApp } from '@/components/providers/AppProvider'
import { MagneticButton } from '@/components/ui/Magnetic'

export function OrderTracking() {
  const { playChime, cart, playClick } = useApp()
  const [confirmed, setConfirmed] = useState(false)

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price, 0),
    [cart],
  )

  return (
    <section id="order" className="relative z-10 py-24 md:py-32">
      <div className="mx-auto max-w-xl px-6 md:px-10">
        <Reveal>
          <p className="mb-3 text-[10px] tracking-[0.35em] text-gold uppercase">Checkout</p>
          <h2 className="font-display text-4xl text-ivory md:text-5xl">Your order</h2>
        </Reveal>

        <Reveal delay={0.1} className="mt-10">
          <div className="glass rounded-[1.75rem] p-7 md:p-9">
            {cart.length === 0 ? (
              <p className="text-sm text-soft/75">
                Your cart is empty. Add items from the menu to continue.
              </p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-auto text-sm text-soft/85">
                {cart.map((c, i) => (
                  <li
                    key={`${c.id}-${i}`}
                    className="flex justify-between gap-4 border-b border-ivory/5 py-2.5"
                  >
                    <span>{c.name}</span>
                    <span className="text-gold-soft">${c.price.toFixed(0)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex items-center justify-between border-t border-ivory/10 pt-5">
              <span className="text-[10px] tracking-[0.22em] text-muted uppercase">Total</span>
              <span className="font-display text-2xl text-ivory">${total.toFixed(0)}</span>
            </div>

            <MagneticButton
              strength={0.25}
              className="mt-8 w-full"
              onClick={() => {
                if (!cart.length) return
                playClick()
                setConfirmed(true)
                playChime()
              }}
            >
              <span className="flex w-full items-center justify-center rounded-full bg-ivory py-4 text-[10px] tracking-[0.28em] text-void uppercase disabled:opacity-40">
                {confirmed ? 'Order placed' : 'Place order'}
              </span>
            </MagneticButton>

            {confirmed && (
              <p className="mt-4 text-center text-sm text-gold-soft">
                Thanks — Safra is preparing your order.
              </p>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
