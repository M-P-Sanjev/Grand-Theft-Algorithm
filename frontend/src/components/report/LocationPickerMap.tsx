'use client'

import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Props = {
  lat: number | null
  lng: number | null
  onPick: (lat: number, lng: number) => void
}

export function LocationPickerMap({ lat, lng, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!containerRef.current || mapRef.current) return
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [lat ?? 20.5937, lng ?? 78.9629],
        zoom: lat != null ? 14 : 5,
        scrollWheelZoom: true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        onPick(e.latlng.lat, e.latlng.lng)
      })

      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 80)
      window.setTimeout(() => map.invalidateSize(), 300)
    }

    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // init once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function syncMarker() {
      const map = mapRef.current
      if (!map || lat == null || lng == null) return
      const L = (await import('leaflet')).default
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        markerRef.current = L.marker([lat, lng]).addTo(map)
      }
      map.setView([lat, lng], Math.max(map.getZoom(), 13))
      map.invalidateSize()
    }
    void syncMarker()
  }, [lat, lng])

  return (
    <div className="overflow-hidden rounded-2xl border border-ivory/10">
      <div ref={containerRef} className="h-[220px] w-full" />
      <p className="bg-void/50 px-3 py-2 text-[10px] tracking-[0.16em] text-muted uppercase">
        Tap the map to set delivery area
      </p>
    </div>
  )
}
