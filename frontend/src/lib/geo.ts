/** Privacy-aware geo helpers for Haven crisis reporting. */

export type GeoAccuracy = 'excellent' | 'good' | 'approximate' | 'unknown'

export type PlaceHit = {
  id: string
  name: string
  kind: 'police' | 'hospital' | 'ngo' | 'shelter' | 'help_centre'
  lat: number
  lng: number
  distanceKm: number
  etaMin: number
  address?: string
}

export type ReverseResult = {
  label: string
  city?: string
  district?: string
  state?: string
  country?: string
}

const CACHE_KEY = 'haven_location_cache_v1'
const PENDING_KEY = 'haven_location_pending_v1'

export function accuracyBand(meters: number | null | undefined): GeoAccuracy {
  if (meters == null || Number.isNaN(meters)) return 'unknown'
  if (meters <= 15) return 'excellent'
  if (meters <= 60) return 'good'
  return 'approximate'
}

export function accuracyLabel(band: GeoAccuracy, meters?: number | null): string {
  if (band === 'excellent') return `Excellent (±${Math.round(meters || 10)}m)`
  if (band === 'good') return `Good (±${Math.round(meters || 50)}m)`
  if (band === 'approximate') {
    return meters != null ? `Approximate (±${Math.round(meters)}m)` : 'Approximate'
  }
  return 'Unknown'
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Fuzz precise GPS to ~1km grid for privacy mode. */
export function fuzzCoords(lat: number, lng: number) {
  const step = 0.01 // ~1.1km
  return {
    lat: Math.round(lat / step) * step,
    lng: Math.round(lng / step) * step,
    radius_m: 1000,
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address || {}
    const city =
      a.city || a.town || a.village || a.suburb || a.municipality || a.county
    const district = a.state_district || a.county || a.suburb
    const state = a.state
    const label = [city, state].filter(Boolean).join(', ') || data.display_name?.split(',').slice(0, 2).join(',')
    return { label: label || 'Approximate area', city, district, state, country: a.country }
  } catch {
    return null
  }
}

export async function searchNominatim(query: string): Promise<
  { lat: number; lng: number; label: string }[]
> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&addressdetails=1&limit=6`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data = (await res.json()) as { lat: string; lon: string; display_name: string }[]
    return data.map((d) => ({
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      label: d.display_name,
    }))
  } catch {
    return []
  }
}

const KIND_QUERIES: { kind: PlaceHit['kind']; q: string }[] = [
  { kind: 'police', q: 'police station' },
  { kind: 'hospital', q: 'hospital' },
  { kind: 'help_centre', q: "women's help desk" },
  { kind: 'ngo', q: 'NGO women support' },
  { kind: 'shelter', q: 'women shelter home' },
]

export async function findNearbySafePlaces(
  lat: number,
  lng: number,
): Promise<PlaceHit[]> {
  const out: PlaceHit[] = []
  await Promise.all(
    KIND_QUERIES.map(async ({ kind, q }) => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}` +
          `&limit=1&viewbox=${lng - 0.12},${lat + 0.12},${lng + 0.12},${lat - 0.12}&bounded=1`
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) return
        const data = (await res.json()) as {
          lat: string
          lon: string
          display_name: string
          place_id: number
        }[]
        const hit = data[0]
        if (!hit) return
        const plat = parseFloat(hit.lat)
        const plng = parseFloat(hit.lon)
        const distanceKm = haversineKm({ lat, lng }, { lat: plat, lng: plng })
        const etaMin = Math.max(3, Math.round((distanceKm / 25) * 60))
        out.push({
          id: `${kind}-${hit.place_id}`,
          name: hit.display_name.split(',').slice(0, 2).join(',').trim(),
          kind,
          lat: plat,
          lng: plng,
          distanceKm: Math.round(distanceKm * 10) / 10,
          etaMin,
          address: hit.display_name,
        })
      } catch {
        /* ignore single kind failure */
      }
    }),
  )
  return out.sort((a, b) => a.distanceKm - b.distanceKm)
}

export function cacheLocationLocally(payload: Record<string, unknown>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, cached_at: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function readCachedLocation(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export function clearCachedLocation() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/** Queue a location upload for when the network returns. */
export function queuePendingLocationUpload(payload: {
  caseId: string
  token: string
  lat: number
  lng: number
  accuracy?: number | null
  live?: boolean
}) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...payload, queued_at: Date.now() }),
    )
  } catch {
    /* ignore */
  }
}

export function readPendingLocationUpload(): {
  caseId: string
  token: string
  lat: number
  lng: number
  accuracy?: number | null
  live?: boolean
} | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearPendingLocationUpload() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

export async function flushPendingLocationUpload(apiBase: string): Promise<boolean> {
  const pending = readPendingLocationUpload()
  if (!pending?.caseId || !pending.token) return false
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/cases/${pending.caseId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: pending.token,
        lat: pending.lat,
        lng: pending.lng,
        accuracy: pending.accuracy ?? null,
        live: !!pending.live,
      }),
    })
    if (res.ok) {
      clearPendingLocationUpload()
      return true
    }
  } catch {
    /* stay queued */
  }
  return false
}

export function mapsDirectionsUrl(lat: number, lng: number) {
  return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}`
}
