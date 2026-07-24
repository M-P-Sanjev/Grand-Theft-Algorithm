'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapCase = {
  id: string
  name: string
  severity: string
  risk_score?: number | null
  lat?: number | null
  lng?: number | null
  location_privacy?: {
    live_tracking?: boolean
    accuracy_band?: string
  } | null
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
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
  // mapReady flips to true once the async Leaflet import finishes so that
  // syncMarkers re-runs even when cases arrive before the map initializes.
  const [mapReady, setMapReady] = useState(false)

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
        zoomControl: false,
        attributionControl: false,
      })
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map)
      L.control.zoom({ position: 'bottomright' }).addTo(map)
      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 100)
      window.setTimeout(() => map.invalidateSize(), 400)
      setMapReady(true)
    }

    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markersRef.current = []
    }
  }, [])

  // Re-run whenever cases, selection, or map readiness changes.
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
        const color = SEVERITY_COLOR[(c.severity || '').toLowerCase()] || '#d4a574'
        const isSelected = c.id === selectedId
        const live = !!c.location_privacy?.live_tracking
        const size = isSelected ? 24 : live ? 20 : 16
        const pulseMs = live ? 1.1 : 1.6
        const icon = L.divIcon({
          className: 'haven-pulse-marker',
          html: `<div style="position:relative;width:${size}px;height:${size}px;">
            <span style="
              position:absolute;inset:0;border-radius:9999px;background:${color};
              opacity:0.4;animation:havenAdminPulse ${pulseMs}s ease-out infinite;
            "></span>
            <span style="
              position:absolute;inset:3px;border-radius:9999px;background:${color};
              border:2px solid #f3eee6;
            "></span>
          </div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        })
        const marker = L.marker([c.lat as number, c.lng as number], { icon })
          .addTo(map)
          .bindTooltip(
            `${c.name} · ${c.severity}${live ? ' · LIVE' : ''}${
              c.risk_score != null ? ` · ${c.risk_score}` : ''
            }`,
            { direction: 'top', className: 'haven-map-tip' },
          )
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
  }, [cases, selectedId, onSelect, mapReady])

  const hasCoords = cases.some(
    (c) => typeof c.lat === 'number' && typeof c.lng === 'number',
  )

  return (
    <div className="haven-admin-map overflow-hidden rounded-[1.25rem] border border-ivory/10 bg-void/40">
      <style>{`
        @keyframes havenAdminPulse{0%{transform:scale(0.7);opacity:0.55}70%{transform:scale(1.9);opacity:0}100%{opacity:0}}
        .haven-admin-map .leaflet-control-zoom a{
          background:#14110f!important;color:#f3eee6!important;border:1px solid rgba(243,238,230,.15)!important;
          width:32px!important;height:32px!important;line-height:30px!important;
        }
        .haven-admin-map .leaflet-bar{border:none!important;box-shadow:none!important}
        .haven-admin-map .leaflet-control-attribution{display:none!important}
        .haven-map-tip{
          background:#14110f!important;color:#f3eee6!important;border:1px solid rgba(243,238,230,.2)!important;
          border-radius:10px!important;box-shadow:none!important;
        }
        .haven-map-tip::before{border-top-color:#14110f!important}
      `}</style>
      <div ref={containerRef} className="h-[360px] w-full md:h-[480px]" />
      {!hasCoords && (
        <p className="border-t border-ivory/10 bg-void/50 px-4 py-3 text-xs text-muted">
          Waiting for optional survivor location. Reports continue without GPS.
        </p>
      )}
      <p className="border-t border-ivory/10 bg-void/40 px-4 py-2 text-[10px] tracking-[0.14em] text-muted uppercase">
        Live pulse · green low · yellow medium · orange high · red critical
      </p>
    </div>
  )
}
