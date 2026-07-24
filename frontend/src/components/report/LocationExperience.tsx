'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  accuracyBand,
  accuracyLabel,
  cacheLocationLocally,
  findNearbySafePlaces,
  flushPendingLocationUpload,
  fuzzCoords,
  mapsDirectionsUrl,
  queuePendingLocationUpload,
  readCachedLocation,
  reverseGeocode,
  searchNominatim,
  type GeoAccuracy,
  type PlaceHit,
  type ReverseResult,
} from '@/lib/geo'

const API =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8000'

const SafeMap = dynamic(
  () => import('@/components/report/SafeLocationMap').then((m) => m.SafeLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[240px] items-center justify-center rounded-2xl border border-ivory/10 text-xs text-muted">
        Preparing map…
      </div>
    ),
  },
)

export type LocationPayload = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  accuracyBand: GeoAccuracy
  label: string
  city?: string
  district?: string
  state?: string
  hideExact: boolean
  source: 'gps' | 'address' | 'map' | 'none' | 'cache'
  liveSharing: boolean
  places: PlaceHit[]
}

type Props = {
  criticalHint?: boolean
  caseId?: string
  authToken?: string
  /** Resume live sharing after the case is created. */
  autoStartLive?: boolean
  onChange: (payload: LocationPayload) => void
}

type Phase = 'finding' | 'ready' | 'denied' | 'address' | 'map' | 'skipped'

export function LocationExperience({
  criticalHint,
  caseId,
  authToken,
  autoStartLive,
  onChange,
}: Props) {
  const [phase, setPhase] = useState<Phase>('finding')
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [reverse, setReverse] = useState<ReverseResult | null>(null)
  const [hideExact, setHideExact] = useState(true)
  const [source, setSource] = useState<LocationPayload['source']>('none')
  const [places, setPlaces] = useState<PlaceHit[]>([])
  const [placesLoading, setPlacesLoading] = useState(false)
  const [addressQuery, setAddressQuery] = useState('')
  const [suggestions, setSuggestions] = useState<{ lat: number; lng: number; label: string }[]>([])
  const [liveSharing, setLiveSharing] = useState(false)
  const [liveAsk, setLiveAsk] = useState(false)
  const [searching, setSearching] = useState(false)
  const [denyKind, setDenyKind] = useState<'permission' | 'timeout' | 'unavailable'>('timeout')
  const watchRef = useRef<number | null>(null)
  const liveTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const gotFixRef = useRef(false)
  const attemptRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const band = useMemo(() => accuracyBand(accuracy), [accuracy])

  function emit(partial?: Partial<LocationPayload>) {
    const payload: LocationPayload = {
      lat,
      lng,
      accuracy,
      accuracyBand: band,
      label: reverse?.label || '',
      city: reverse?.city,
      district: reverse?.district,
      state: reverse?.state,
      hideExact,
      source,
      liveSharing,
      places,
      ...partial,
    }
    onChange(payload)
    if (payload.lat != null || payload.label) {
      cacheLocationLocally(payload as unknown as Record<string, unknown>)
    }
  }

  useEffect(() => {
    emit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, accuracy, reverse, hideExact, source, liveSharing, places])

  useEffect(() => {
    void detectGps()
    return () => {
      attemptRef.current += 1
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      if (watchRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
      }
      if (liveTimer.current) clearInterval(liveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (criticalHint && (lat != null || reverse?.label) && !liveSharing) {
      setLiveAsk(true)
    }
  }, [criticalHint, lat, reverse, liveSharing])

  useEffect(() => {
    const onOnline = () => {
      void flushPendingLocationUpload(API)
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void flushPendingLocationUpload(API)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  useEffect(() => {
    if (autoStartLive && caseId && authToken && !liveSharing && !liveTimer.current) {
      startLiveShare()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartLive, caseId, authToken])

  useEffect(() => {
    if (lat == null || lng == null) return
    let cancelled = false
    setPlacesLoading(true)
    void findNearbySafePlaces(lat, lng).then((list) => {
      if (!cancelled) {
        setPlaces(list)
        setPlacesLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [lat, lng])

  function clearSettleTimer() {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }

  function stopWatch() {
    if (watchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
  }

  async function applyCoords(
    nextLat: number,
    nextLng: number,
    nextAcc: number | null,
    nextSource: LocationPayload['source'],
  ) {
    clearSettleTimer()
    gotFixRef.current = true
    setLat(nextLat)
    setLng(nextLng)
    setAccuracy(nextAcc)
    setSource(nextSource)
    setPhase('ready')
    const rev = await reverseGeocode(nextLat, nextLng)
    setReverse(rev)
  }

  function ensureBackgroundWatch(attempt: number) {
    if (!navigator.geolocation || watchRef.current != null) return
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (attempt !== attemptRef.current) return
        const nextLat = pos.coords.latitude
        const nextLng = pos.coords.longitude
        const nextAcc = pos.coords.accuracy
        // Always promote to ready on first fix — even after denied/skipped
        if (!gotFixRef.current) {
          void applyCoords(nextLat, nextLng, nextAcc, 'gps')
          return
        }
        setLat(nextLat)
        setLng(nextLng)
        setAccuracy(nextAcc)
        void reverseGeocode(nextLat, nextLng).then((rev) => {
          if (rev && attempt === attemptRef.current) setReverse(rev)
        })
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 25000 },
    )
  }

  async function tryIpApproximate(attempt: number): Promise<boolean> {
    const ctrl = new AbortController()
    const kill = setTimeout(() => ctrl.abort(), 6000)
    try {
      const res = await fetch('https://get.geojs.io/v1/ip/geo.json', {
        signal: ctrl.signal,
      })
      if (!res.ok || attempt !== attemptRef.current) return false
      const data = (await res.json()) as {
        latitude?: string
        longitude?: string
        city?: string
        region?: string
        country?: string
      }
      const nextLat = parseFloat(String(data.latitude))
      const nextLng = parseFloat(String(data.longitude))
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return false
      if (attempt !== attemptRef.current || gotFixRef.current) return true
      clearSettleTimer()
      gotFixRef.current = true
      setLat(nextLat)
      setLng(nextLng)
      setAccuracy(8000)
      setSource('gps')
      setPhase('ready')
      const label = [data.city, data.region || data.country].filter(Boolean).join(', ')
      if (label) {
        setReverse({
          label,
          city: data.city,
          state: data.region,
          country: data.country,
        })
      } else {
        const rev = await reverseGeocode(nextLat, nextLng)
        if (attempt === attemptRef.current) setReverse(rev)
      }
      return true
    } catch {
      return false
    } finally {
      clearTimeout(kill)
    }
  }

  function failGps(err?: GeolocationPositionError | null, attempt?: number) {
    if (attempt != null && attempt !== attemptRef.current) return
    if (gotFixRef.current) return

    const cached = readCachedLocation()
    if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
      void applyCoords(cached.lat as number, cached.lng as number, null, 'cache')
      return
    }

    const code = err?.code
    if (code === 1) setDenyKind('permission')
    else if (code === 3) setDenyKind('timeout')
    else setDenyKind('unavailable')

    // City-level IP fallback so reporting still gets an approximate area
    const a = attempt ?? attemptRef.current
    void tryIpApproximate(a).then((ok) => {
      if (ok || gotFixRef.current || a !== attemptRef.current) return
      setSource('none')
      // Stay on denied with recovery actions — never auto-skip
      setPhase('denied')
      ensureBackgroundWatch(a)
    })
  }

  function scheduleFail(
    err: GeolocationPositionError | null | undefined,
    attempt: number,
    delayMs: number,
  ) {
    clearSettleTimer()
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      if (!gotFixRef.current) failGps(err, attempt)
    }, delayMs)
  }

  function detectGps() {
    clearSettleTimer()
    const attempt = ++attemptRef.current
    gotFixRef.current = false
    if (!navigator.geolocation) {
      failGps(null, attempt)
      return
    }
    setPhase('finding')
    // Fresh watch on each attempt so Try Again can recover
    stopWatch()
    ensureBackgroundWatch(attempt)

    // Pass 1: fast approximate (Wi‑Fi / network / cached)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (attempt !== attemptRef.current) return
        void applyCoords(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          'gps',
        )
      },
      (err1) => {
        if (attempt !== attemptRef.current) return
        if (err1?.code === 1) {
          // Permission denied — brief grace for watch, then fallback
          scheduleFail(err1, attempt, 2000)
          return
        }
        // Pass 2: high accuracy with longer timeout
        setPhase('finding')
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (attempt !== attemptRef.current) return
            void applyCoords(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.accuracy,
              'gps',
            )
          },
          (err2) => {
            if (attempt !== attemptRef.current) return
            // Extra grace so background watch can still deliver a late fix
            scheduleFail(err2 || err1, attempt, 10000)
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        )
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }

  async function onAddressSearch(q: string) {
    setAddressQuery(q)
    if (q.trim().length < 2) {
      setSuggestions([])
      return
    }
    setSearching(true)
    const hits = await searchNominatim(q)
    setSuggestions(hits)
    setSearching(false)
  }

  function startLiveShare() {
    setLiveSharing(true)
    setLiveAsk(false)
    if (!caseId || !authToken) {
      // Consent saved; live posts begin once the case exists.
      return
    }
    const push = () => {
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const body = {
            token: authToken,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            live: true,
          }
          if (!navigator.onLine) {
            queuePendingLocationUpload({
              caseId,
              token: authToken,
              lat: body.lat,
              lng: body.lng,
              accuracy: body.accuracy,
              live: true,
            })
            cacheLocationLocally({ ...body, caseId })
            return
          }
          void fetch(`${API}/cases/${caseId}/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).catch(() => {
            queuePendingLocationUpload({
              caseId,
              token: authToken,
              lat: body.lat,
              lng: body.lng,
              accuracy: body.accuracy,
              live: true,
            })
          })
          setLat(pos.coords.latitude)
          setLng(pos.coords.longitude)
          setAccuracy(pos.coords.accuracy)
        },
        () => undefined,
        { enableHighAccuracy: true, timeout: 10000 },
      )
    }
    push()
    liveTimer.current = setInterval(push, 15000)
  }

  function stopLiveShare() {
    setLiveSharing(false)
    if (liveTimer.current) {
      clearInterval(liveTimer.current)
      liveTimer.current = null
    }
  }

  const displayCoords =
    hideExact && lat != null && lng != null ? fuzzCoords(lat, lng) : null

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-ivory/10 bg-void/50 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="border-b border-ivory/10 px-5 py-4">
        <p className="text-[10px] tracking-[0.22em] text-gold uppercase">Location</p>
        <p className="mt-1 text-sm text-soft/75">
          Optional · privacy-first · never required to continue
        </p>
      </div>

      <div className="space-y-4 p-5">
        <AnimatePresence mode="wait">
          {phase === 'finding' && (
            <motion.div
              key="finding"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 rounded-2xl border border-ivory/10 bg-panel/40 px-4 py-4"
            >
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold/50" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-gold" />
              </span>
              <p className="text-sm text-ivory">Finding your location…</p>
            </motion.div>
          )}

          {phase === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="rounded-2xl border border-gold/25 bg-gold/10 px-4 py-3">
                <p className="text-[10px] tracking-[0.16em] text-muted uppercase">
                  Approximate location
                </p>
                <p className="mt-1 text-base text-ivory">
                  📍{' '}
                  {reverse?.label ||
                    [reverse?.city, reverse?.state].filter(Boolean).join(', ') ||
                    (accuracy != null
                      ? `Within ${Math.round(accuracy)}m of your current position`
                      : 'Approximate area detected')}
                </p>
                <p className="mt-2 text-sm text-soft/80">
                  Accuracy{' '}
                  {accuracy != null ? `±${Math.round(accuracy)}m` : accuracyLabel(band, accuracy)}
                </p>
                {source === 'gps' && reverse?.label && (
                  <p className="mt-2 text-[10px] tracking-[0.14em] text-gold-soft uppercase">
                    ✓ Location updated
                  </p>
                )}
                {hideExact && (
                  <p className="mt-1 text-[10px] text-muted">Exact GPS hidden for privacy</p>
                )}
              </div>
            </motion.div>
          )}

          {phase === 'denied' && (
            <motion.div
              key="denied"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="rounded-2xl border border-ivory/10 bg-panel/30 px-4 py-4">
                <p className="text-sm text-ivory">We couldn&apos;t access your location.</p>
                <p className="mt-2 text-sm text-soft/80">
                  That&apos;s completely okay. You can continue without sharing it.
                </p>
                {denyKind === 'permission' ? (
                  <p className="mt-2 text-xs text-muted">
                    If you meant to allow it: click the lock icon in the address bar → Location → Allow, then Try Again.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-gold-soft">
                    Still working in the background… if a fix arrives, we&apos;ll update this automatically.
                  </p>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={detectGps}
                  className="rounded-2xl border border-ivory/15 px-3 py-3 text-left text-sm text-soft hover:border-gold/35"
                >
                  📍 Try Again
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('address')}
                  className="rounded-2xl border border-ivory/15 px-3 py-3 text-left text-sm text-soft hover:border-gold/35"
                >
                  🏠 Enter Address
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('map')}
                  className="rounded-2xl border border-ivory/15 px-3 py-3 text-left text-sm text-soft hover:border-gold/35"
                >
                  🗺 Choose on Map
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase('skipped')
                  setSource('none')
                }}
                className="text-[10px] tracking-[0.18em] text-muted uppercase"
              >
                Continue without location
              </button>
            </motion.div>
          )}

          {(phase === 'address' || phase === 'map') && (
            <motion.div
              key="manual"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              <div>
                <label className="text-[10px] tracking-[0.16em] text-muted uppercase">
                  Search location…
                </label>
                <input
                  value={addressQuery}
                  onChange={(e) => void onAddressSearch(e.target.value)}
                  placeholder="Search location…"
                  className="mt-2 w-full rounded-2xl border border-ivory/15 bg-void/60 px-4 py-3 text-sm text-ivory outline-none focus:border-gold/40"
                />
                {searching && (
                  <p className="mt-2 text-xs text-muted">Searching…</p>
                )}
                {!!suggestions.length && (
                  <ul className="mt-2 max-h-40 overflow-y-auto rounded-2xl border border-ivory/10 bg-void/80">
                    {suggestions.map((s) => (
                      <li key={s.label + s.lat}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-xs text-soft hover:bg-gold/10"
                          onClick={() => {
                            void applyCoords(s.lat, s.lng, null, 'address')
                            setSuggestions([])
                            setAddressQuery(s.label)
                          }}
                        >
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {phase === 'map' && (
                <SafeMap
                  lat={lat}
                  lng={lng}
                  places={places}
                  hideExact={hideExact}
                  onPick={(a, b) => void applyCoords(a, b, null, 'map')}
                />
              )}
              <button
                type="button"
                onClick={() => setPhase(lat != null ? 'ready' : 'denied')}
                className="text-[10px] tracking-[0.16em] text-muted uppercase"
              >
                Back
              </button>
            </motion.div>
          )}

          {phase === 'skipped' && (
            <motion.p
              key="skipped"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-soft/80"
            >
              Continuing without location. You can add it later if you want.
            </motion.p>
          )}
        </AnimatePresence>

        {(phase === 'ready' || lat != null) && (
          <>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-ivory/10 px-4 py-3">
              <span className="text-sm text-ivory">🔒 Hide exact location</span>
              <input
                type="checkbox"
                checked={hideExact}
                onChange={(e) => setHideExact(e.target.checked)}
                className="h-4 w-4 accent-[var(--gold,#d4a574)]"
              />
            </label>

            {phase === 'ready' && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPhase('address')}
                  className="rounded-full border border-ivory/15 px-3 py-1.5 text-[10px] tracking-[0.14em] text-soft uppercase"
                >
                  Search location
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('map')}
                  className="rounded-full border border-ivory/15 px-3 py-1.5 text-[10px] tracking-[0.14em] text-soft uppercase"
                >
                  Choose on Map
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-ivory/10 px-4 py-3">
              <p className="text-[10px] tracking-[0.18em] text-muted uppercase">
                Nearby safe places
              </p>
              {placesLoading && (
                <p className="mt-2 text-xs text-muted">Looking nearby…</p>
              )}
              {!placesLoading && !places.length && lat != null && (
                <p className="mt-2 text-xs text-soft/70">
                  No directory hits yet — try 112 / 1091 while we keep searching.
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {places.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ivory/8 bg-panel/30 px-3 py-2"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-wider text-gold-soft">
                        {p.kind.replace('_', ' ')}
                      </p>
                      <p className="text-sm text-ivory">{p.name}</p>
                      <p className="text-[10px] text-muted">
                        {p.distanceKm} km · ~{p.etaMin} min
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={mapsDirectionsUrl(p.lat, p.lng)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-ivory/15 px-3 py-1 text-[10px] uppercase tracking-wider text-soft"
                      >
                        Directions
                      </a>
                      <a
                        href={
                          p.kind === 'police'
                            ? 'tel:112'
                            : p.kind === 'help_centre'
                              ? 'tel:1091'
                              : 'tel:112'
                        }
                        className="rounded-full bg-ivory/90 px-3 py-1 text-[10px] uppercase tracking-wider text-void"
                      >
                        Call
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {liveAsk && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-4">
            <p className="text-sm text-ivory">
              Would you like to securely share your live location with responders?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startLiveShare}
                className="rounded-full bg-ivory px-4 py-2 text-[10px] tracking-[0.16em] text-void uppercase"
              >
                Yes, share live
              </button>
              <button
                type="button"
                onClick={() => setLiveAsk(false)}
                className="rounded-full border border-ivory/20 px-4 py-2 text-[10px] tracking-[0.16em] text-soft uppercase"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {liveSharing && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3">
            <div>
              <p className="text-sm text-gold-soft">Live location shared</p>
              <p className="text-[10px] tracking-[0.14em] text-muted uppercase">
                Updating every 15 seconds
              </p>
            </div>
            <button
              type="button"
              onClick={stopLiveShare}
              className="rounded-full border border-ivory/20 px-3 py-1.5 text-[10px] tracking-[0.14em] uppercase"
            >
              Stop sharing
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Build FormData fields from location payload (privacy aware). */
export function appendLocationToForm(body: FormData, loc: LocationPayload | null) {
  if (!loc) return
  if (loc.label) body.append('location', loc.label)
  if (loc.city) body.append('location_city', loc.city)
  if (loc.district) body.append('location_district', loc.district)
  if (loc.state) body.append('location_state', loc.state)
  body.append('location_hide_exact', loc.hideExact ? '1' : '0')
  body.append('location_accuracy_band', loc.accuracyBand)
  if (loc.accuracy != null) body.append('location_accuracy_m', String(loc.accuracy))
  body.append('location_source', loc.source)
  body.append('location_live', loc.liveSharing ? '1' : '0')

  if (loc.lat != null && loc.lng != null) {
    if (loc.hideExact) {
      const f = fuzzCoords(loc.lat, loc.lng)
      body.append('lat', String(f.lat))
      body.append('lng', String(f.lng))
      body.append('location_radius_m', String(f.radius_m))
    } else {
      body.append('lat', String(loc.lat))
      body.append('lng', String(loc.lng))
    }
  }
  const nearest = loc.places[0]
  if (nearest) {
    body.append('location_nearest_eta_min', String(nearest.etaMin))
    body.append('location_nearest_kind', nearest.kind)
  }
}
