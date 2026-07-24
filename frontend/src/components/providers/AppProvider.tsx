'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { MenuItem } from '@/lib/constants'

type SfxApi = {
  whoosh: () => void
  click: () => void
  chime: () => void
  hit: () => void
  pop: () => void
  plate: () => void
}

type AppContextValue = {
  ready: boolean
  setReady: (v: boolean) => void
  loadingDone: boolean
  setLoadingDone: (v: boolean) => void
  introDone: boolean
  setIntroDone: (v: boolean) => void
  scrollProgress: number
  setScrollProgress: (v: number) => void
  scrollY: number
  setScrollY: (v: number) => void
  audioEnabled: boolean
  setAudioEnabled: (v: boolean) => void
  registerAudio: (api: SfxApi) => void
  playWhoosh: () => void
  playClick: () => void
  playChime: () => void
  playHit: () => void
  playPop: () => void
  playPlate: () => void
  cart: MenuItem[]
  addToCart: (item: MenuItem) => void
  favorites: Set<string>
  toggleFavorite: (id: string) => void
  category: string
  setCategory: (id: string) => void
  query: string
  setQuery: (q: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [loadingDone, setLoadingDone] = useState(false)
  const [introDone, setIntroDone] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [cart, setCart] = useState<MenuItem[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const sfx = useRef<SfxApi | null>(null)

  const registerAudio = useCallback((api: SfxApi) => {
    sfx.current = api
  }, [])

  const playWhoosh = useCallback(() => sfx.current?.whoosh(), [])
  const playClick = useCallback(() => sfx.current?.click(), [])
  const playChime = useCallback(() => sfx.current?.chime(), [])
  const playHit = useCallback(() => sfx.current?.hit(), [])
  const playPop = useCallback(() => sfx.current?.pop(), [])
  const playPlate = useCallback(() => sfx.current?.plate(), [])

  const addToCart = useCallback((item: MenuItem) => {
    setCart((c) => [...c, item])
    sfx.current?.pop()
  }, [])

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    sfx.current?.click()
  }, [])

  const value = useMemo(
    () => ({
      ready,
      setReady,
      loadingDone,
      setLoadingDone,
      introDone,
      setIntroDone,
      scrollProgress,
      setScrollProgress,
      scrollY,
      setScrollY,
      audioEnabled,
      setAudioEnabled,
      registerAudio,
      playWhoosh,
      playClick,
      playChime,
      playHit,
      playPop,
      playPlate,
      cart,
      addToCart,
      favorites,
      toggleFavorite,
      category,
      setCategory,
      query,
      setQuery,
    }),
    [
      ready,
      loadingDone,
      introDone,
      scrollProgress,
      scrollY,
      audioEnabled,
      registerAudio,
      playWhoosh,
      playClick,
      playChime,
      playHit,
      playPop,
      playPlate,
      cart,
      addToCart,
      favorites,
      toggleFavorite,
      category,
      query,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
