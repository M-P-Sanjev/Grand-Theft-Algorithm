'use client'

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr, Environment } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { NovaWorld } from '@/components/canvas/RestaurantWorld'
import { CinematicCamera } from '@/components/canvas/CinematicCamera'
import { useApp } from '@/components/providers/AppProvider'
import { useReducedMotion } from '@/lib/utils'

/** Warm rooftop lamp lighting — no cool neon fill */
function Lights() {
  const { scrollProgress } = useApp()
  const key = useMemo(() => (scrollProgress < 0.5 ? 0.55 : 0.4), [scrollProgress])

  return (
    <>
      <ambientLight intensity={0.08} color="#1a120c" />
      <directionalLight
        castShadow
        position={[2.5, 4.5, 1.8]}
        intensity={key}
        color="#ffc090"
        shadow-mapSize={[512, 512]}
        shadow-bias={-0.0003}
      />
      <directionalLight position={[-1.5, 2, -2]} intensity={0.12} color="#4a5568" />
      <spotLight
        position={[-0.9, 2.2, 0.2]}
        angle={0.65}
        penumbra={0.85}
        intensity={0.9}
        color="#ffb060"
        castShadow
      />
    </>
  )
}

function PostFX() {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom intensity={0.18} luminanceThreshold={0.78} mipmapBlur />
      <Vignette offset={0.38} darkness={0.55} />
    </EffectComposer>
  )
}

export function WorldCanvas() {
  const { scrollProgress, introDone } = useApp()
  const active = !introDone || scrollProgress < 0.22

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 transition-opacity duration-500 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden
    >
      {!active && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,#2a1a10_0%,#060504_65%)]" />
      )}
      <Canvas
        dpr={[1, 1.25]}
        shadows
        frameloop={active ? 'always' : 'never'}
        performance={{ min: 0.5 }}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
        }}
        camera={{ position: [0, 1.45, 3.4], fov: 35, near: 0.1, far: 40 }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 0.95
        }}
      >
        <color attach="background" args={['#060504']} />
        <fog attach="fog" args={['#060504', 5, 13]} />
        <Suspense fallback={null}>
          <Lights />
          <CinematicCamera />
          <NovaWorld />
          <Environment preset="night" environmentIntensity={0.25} />
          <PostFX />
        </Suspense>
        <AdaptiveDpr pixelated />
      </Canvas>
    </div>
  )
}
