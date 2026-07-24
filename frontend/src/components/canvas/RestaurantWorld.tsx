'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ContactShadows, useTexture } from '@react-three/drei'
import * as THREE from 'three'

/** Theme 1 — Rooftop Night: burger + ramen under warm lamp, city bokeh */
const FOOD = [
  {
    name: 'burger',
    img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1024&q=80',
    pos: [-0.42, 0.9, 0.12] as [number, number, number],
    rot: [-Math.PI / 2.15, 0.05, 0.08] as [number, number, number],
    scale: 0.48,
  },
  {
    name: 'ramen',
    img: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=1024&q=80',
    pos: [0.42, 0.9, 0.18] as [number, number, number],
    rot: [-Math.PI / 2.2, -0.04, -0.06] as [number, number, number],
    scale: 0.4,
  },
]

const CITY = '/themes/rooftop-night.png'

const WOOD = {
  map: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dark_wood/dark_wood_diff_1k.jpg',
  roughnessMap:
    'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/dark_wood/dark_wood_rough_1k.jpg',
}

function Steam({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const arr = new Float32Array(16 * 3)
    for (let i = 0; i < 16; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 0.18
      arr[i * 3 + 1] = Math.random() * 0.28
      arr[i * 3 + 2] = (Math.random() - 0.5) * 0.18
    }
    return arr
  }, [])

  useFrame((_, dt) => {
    if (!ref.current) return
    const attr = ref.current.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < attr.count; i++) {
      let y = attr.getY(i) + dt * 0.14
      if (y > 0.5) y = 0
      attr.setY(i, y)
    }
    attr.needsUpdate = true
  })

  return (
    <points ref={ref} position={position}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.028}
        color="#ffd9b0"
        transparent
        opacity={0.28}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

function WoodenTable() {
  const textures = useTexture({
    map: WOOD.map,
    roughnessMap: WOOD.roughnessMap,
  })

  useMemo(() => {
    textures.map.wrapS = textures.map.wrapT = THREE.RepeatWrapping
    textures.roughnessMap.wrapS = textures.roughnessMap.wrapT = THREE.RepeatWrapping
    textures.map.repeat.set(2, 1.3)
    textures.roughnessMap.repeat.set(2, 1.3)
    textures.map.colorSpace = THREE.SRGBColorSpace
    textures.map.anisotropy = 4
  }, [textures])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.78, 0]} receiveShadow>
      <cylinderGeometry args={[1.15, 1.15, 0.05, 32]} />
      <meshStandardMaterial
        map={textures.map}
        roughnessMap={textures.roughnessMap}
        roughness={0.78}
        metalness={0.02}
        envMapIntensity={0.35}
      />
    </mesh>
  )
}

function FoodPlate({
  img,
  position,
  rotation,
  scale,
  steam,
}: {
  img: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  steam?: boolean
}) {
  const texture = useTexture(img)
  texture.colorSpace = THREE.SRGBColorSpace

  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.3 * scale * 1.65, 0.28 * scale * 1.65, 0.02, 32]} />
        <meshStandardMaterial color="#1a1816" roughness={0.45} metalness={0.08} />
      </mesh>
      <mesh castShadow position={[0, 0.014, 0]} rotation={rotation} scale={scale}>
        <circleGeometry args={[0.5, 32]} />
        <meshStandardMaterial map={texture} roughness={0.5} metalness={0.02} />
      </mesh>
      {steam && <Steam position={[0, 0.04, 0]} />}
    </group>
  )
}

/** Cordless conical table lamp — warm pool of light */
function TableLamp({ position }: { position: [number, number, number] }) {
  const glow = useRef<THREE.PointLight>(null)
  useFrame(({ clock }) => {
    if (glow.current) {
      glow.current.intensity = 1.15 + Math.sin(clock.elapsedTime * 2.2) * 0.06
    }
  })

  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.04, 0.055, 0.04, 16]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.18, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.32, 12]} />
        <meshStandardMaterial color="#222" roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <coneGeometry args={[0.14, 0.16, 24]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.45} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <circleGeometry args={[0.11, 24]} />
        <meshStandardMaterial
          color="#ffc080"
          emissive="#ff9a40"
          emissiveIntensity={1.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight
        ref={glow}
        position={[0, 0.32, 0]}
        color="#ffb060"
        intensity={1.2}
        distance={4.5}
        decay={2}
        castShadow
      />
    </group>
  )
}

function CityBackdrop() {
  const texture = useTexture(CITY)
  texture.colorSpace = THREE.SRGBColorSpace

  return (
    <mesh position={[0, 2.4, -5.5]}>
      <planeGeometry args={[14, 8]} />
      <meshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        emissiveIntensity={0.22}
        roughness={1}
      />
    </mesh>
  )
}

function DrinkGlass({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.2, 24]} />
        <meshStandardMaterial
          color="#c4a882"
          transparent
          opacity={0.35}
          roughness={0.15}
          metalness={0.1}
        />
      </mesh>
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.12, 20]} />
        <meshStandardMaterial color="#b87333" roughness={0.35} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

export function NovaWorld() {
  return (
    <group>
      <CityBackdrop />
      <WoodenTable />
      <mesh position={[0, 0.38, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, 0.76, 16]} />
        <meshStandardMaterial color="#14110e" roughness={0.7} />
      </mesh>

      {FOOD.map((f) => (
        <FoodPlate
          key={f.name}
          img={f.img}
          position={f.pos}
          rotation={f.rot}
          scale={f.scale}
          steam={f.name === 'ramen'}
        />
      ))}

      <TableLamp position={[-0.95, 0.8, -0.15]} />
      <DrinkGlass position={[0.15, 0.98, -0.45]} />

      <ContactShadows
        position={[0, 0.781, 0]}
        opacity={0.45}
        scale={5}
        blur={2}
        far={2.5}
        resolution={256}
        frames={1}
      />
    </group>
  )
}
