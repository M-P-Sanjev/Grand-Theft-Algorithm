'use client'

import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapCase = {
  id: string
  name: string
  severity: string
  lat?: number | null
  lng?: number | null
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#22c55e',
}

type Props = {
  cases: MapCase[]
  selectedId?: string | null
  onSelect: (id: string) => void
}

export function CasesMap({ cases, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<Marker[]>([])

  const withCoords = cases.filter(
    (c) => typeof c.lat === 'number' && typeof c.lng === 'number',
  )

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!containerRef.current || mapRef.current) return
      const L = (await import('leaflet')).default

      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [20.5937, 78.9629],
        zoom: 5,
        scrollWheelZoom: true,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)
      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 100)
      window.setTimeout(() => map.invalidateSize(), 400)
    }

    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current = []
    }
  }, [])

  useEffect(() => {
    async function syncMarkers() {
      const map = mapRef.current
      if (!map) return
      const L = (await import('leaflet')).default
      map.invalidateSize()

      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []

      const points = cases.filter(
        (c) => typeof c.lat === 'number' && typeof c.lng === 'number',
      )

      const bounds: [number, number][] = []
      for (const c of points) {
        const color = SEVERITY_COLOR[c.severity] || '#d4a574'
        const isSelected = c.id === selectedId
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:${isSelected ? 18 : 14}px;
            height:${isSelected ? 18 : 14}px;
            border-radius:9999px;
            background:${color};
            border:2px solid #f3eee6;
            box-shadow:0 0 0 ${isSelected ? 4 : 2}px rgba(0,0,0,0.35);
          "></div>`,
          iconSize: [isSelected ? 18 : 14, isSelected ? 18 : 14],
          iconAnchor: [isSelected ? 9 : 7, isSelected ? 9 : 7],
        })
        const marker = L.marker([c.lat as number, c.lng as number], { icon })
          .addTo(map)
          .bindTooltip(`${c.name} · ${c.severity}`, { direction: 'top' })
        marker.on('click', () => onSelect(c.id))
        markersRef.current.push(marker)
        bounds.push([c.lat as number, c.lng as number])
      }

      if (bounds.length === 1) {
        map.setView(bounds[0], 14)
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40] })
      }
    }

    void syncMarkers()
  }, [cases, selectedId, onSelect])

  const hasCoords = cases.some(
    (c) => typeof c.lat === 'number' && typeof c.lng === 'number',
  )

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-ivory/10">
      <div ref={containerRef} className="h-[360px] w-full md:h-[480px]" />
      {!hasCoords && (
        <p className="border-t border-ivory/10 bg-void/40 px-4 py-3 text-xs text-muted">
          No live coordinates yet — survivors must allow location or drop a pin on the report map.
        </p>
      )}
    </div>
  )
}
