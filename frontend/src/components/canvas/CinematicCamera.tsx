'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useApp } from '@/components/providers/AppProvider'
import { lerp } from '@/lib/utils'

/** ~50mm full-frame feel via narrow FOV + slow organic drift */
const PATH = [
  { p: 0.0, pos: [0.15, 1.55, 3.55] as const, look: [0.05, 0.95, 0.1] as const },
  { p: 0.2, pos: [0.55, 1.48, 3.1] as const, look: [0.15, 0.95, 0.05] as const },
  { p: 0.4, pos: [-0.45, 1.7, 2.7] as const, look: [0.05, 0.98, -0.1] as const },
  { p: 0.6, pos: [0.25, 1.9, 2.2] as const, look: [0, 1.0, -0.4] as const },
  { p: 0.8, pos: [0.7, 1.45, 3.2] as const, look: [0.2, 0.95, 0.2] as const },
  { p: 1.0, pos: [0, 1.6, 3.7] as const, look: [0, 0.96, 0] as const },
]

const INTRO_START = { pos: [0.1, 2.1, 5.8] as const, look: [0, 1.0, 0] as const }

function samplePath(t: number) {
  const clamped = Math.min(1, Math.max(0, t))
  let i = 0
  while (i < PATH.length - 1 && PATH[i + 1].p < clamped) i++
  const a = PATH[i]
  const b = PATH[Math.min(i + 1, PATH.length - 1)]
  const span = b.p - a.p || 1
  const k = (clamped - a.p) / span
  const ease = k * k * (3 - 2 * k)
  return {
    pos: new THREE.Vector3(
      lerp(a.pos[0], b.pos[0], ease),
      lerp(a.pos[1], b.pos[1], ease),
      lerp(a.pos[2], b.pos[2], ease),
    ),
    look: new THREE.Vector3(
      lerp(a.look[0], b.look[0], ease),
      lerp(a.look[1], b.look[1], ease),
      lerp(a.look[2], b.look[2], ease),
    ),
  }
}

export function CinematicCamera() {
  const { camera } = useThree()
  const { loadingDone, introDone, setIntroDone, scrollProgress, playHit } = useApp()
  const intro = useRef({ t: 0, started: false, finished: false })
  const look = useRef(new THREE.Vector3(...INTRO_START.look))
  const mouse = useRef({ x: 0, y: 0 })
  const pointerTarget = useRef({ x: 0, y: 0 })
  const shake = useRef({ x: 0, y: 0 })
  const introTarget = useMemo(() => samplePath(0), [])

  useEffect(() => {
    // 50mm-ish cinematic FOV
    if ('fov' in camera) {
      ;(camera as THREE.PerspectiveCamera).fov = 35
      camera.updateProjectionMatrix()
    }
    camera.position.set(...INTRO_START.pos)
    camera.lookAt(...INTRO_START.look)
  }, [camera])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointerTarget.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointerTarget.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    if (!loadingDone || intro.current.started) return
    intro.current.started = true
    playHit()
  }, [loadingDone, playHit])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    mouse.current.x = lerp(mouse.current.x, pointerTarget.current.x * 0.22, 1 - Math.exp(-2.5 * dt))
    mouse.current.y = lerp(mouse.current.y, pointerTarget.current.y * 0.14, 1 - Math.exp(-2.5 * dt))

    // micro handheld shake
    shake.current.x = Math.sin(t * 1.3) * 0.004 + Math.sin(t * 3.1) * 0.0015
    shake.current.y = Math.cos(t * 1.1) * 0.003 + Math.sin(t * 2.7) * 0.0012

    // slow breathing drift
    const breatheX = Math.sin(t * 0.18) * 0.04
    const breatheY = Math.sin(t * 0.14) * 0.025

    if (loadingDone && !intro.current.finished) {
      intro.current.t = Math.min(1, intro.current.t + dt * 0.26)
      const e = 1 - Math.pow(1 - intro.current.t, 3)
      camera.position.set(
        lerp(INTRO_START.pos[0], introTarget.pos.x, e) + mouse.current.x + breatheX + shake.current.x,
        lerp(INTRO_START.pos[1], introTarget.pos.y, e) + mouse.current.y + breatheY + shake.current.y,
        lerp(INTRO_START.pos[2], introTarget.pos.z, e),
      )
      look.current.set(
        lerp(INTRO_START.look[0], introTarget.look.x, e),
        lerp(INTRO_START.look[1], introTarget.look.y, e),
        lerp(INTRO_START.look[2], introTarget.look.z, e),
      )
      camera.lookAt(look.current)
      if (intro.current.t >= 1 && !introDone) {
        intro.current.finished = true
        setIntroDone(true)
      }
      return
    }

    if (!introDone) return
    const target = samplePath(scrollProgress)
    camera.position.x = lerp(
      camera.position.x,
      target.pos.x + mouse.current.x + breatheX + shake.current.x,
      1 - Math.exp(-1.8 * dt),
    )
    camera.position.y = lerp(
      camera.position.y,
      target.pos.y + mouse.current.y + breatheY + shake.current.y,
      1 - Math.exp(-1.8 * dt),
    )
    camera.position.z = lerp(camera.position.z, target.pos.z, 1 - Math.exp(-1.8 * dt))
    look.current.lerp(target.look, 1 - Math.exp(-2 * dt))
    camera.lookAt(look.current)
  })

  return null
}
