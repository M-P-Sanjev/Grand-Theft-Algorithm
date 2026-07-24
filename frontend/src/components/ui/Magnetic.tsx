'use client'

import {
  useCallback,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useReducedMotion } from '@/lib/utils'

type Props = {
  children: ReactNode
  className?: string
  strength?: number
}

function useMagnetic(strength: number) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 22, mass: 0.4 })
  const sy = useSpring(y, { stiffness: 220, damping: 22, mass: 0.4 })

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (reduced || !ref.current) return
      const rect = ref.current.getBoundingClientRect()
      x.set((e.clientX - (rect.left + rect.width / 2)) * strength)
      y.set((e.clientY - (rect.top + rect.height / 2)) * strength)
    },
    [reduced, strength, x, y],
  )

  const onLeave = useCallback(() => {
    x.set(0)
    y.set(0)
  }, [x, y])

  return { ref, sx, sy, onMove, onLeave }
}

export function Magnetic({ children, className = '', strength = 0.35 }: Props) {
  const { ref, sx, sy, onMove, onLeave } = useMagnetic(strength)

  return (
    <motion.div
      ref={ref}
      data-magnetic
      className={className}
      style={{ x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileTap={{ scale: 0.97 }}
    >
      {children}
    </motion.div>
  )
}

type ButtonProps = Props & {
  type?: 'button' | 'submit'
  onClick?: () => void
}

export function MagneticButton({
  children,
  className = '',
  strength = 0.35,
  type = 'button',
  onClick,
}: ButtonProps) {
  const { ref, sx, sy, onMove, onLeave } = useMagnetic(strength)

  return (
    <motion.button
      ref={ref as never}
      type={type}
      onClick={onClick}
      data-magnetic
      className={className}
      style={{ x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileTap={{ scale: 0.97 }}
    >
      {children}
    </motion.button>
  )
}
