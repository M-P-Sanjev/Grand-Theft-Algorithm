'use client'

import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, Marker, Circle } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { PlaceHit } from '@/lib/geo'
import { fuzzCoords } from '@/lib/geo'

type Props = {
  lat: number | null
  lng: number | null
  places?: PlaceHit[]
  hideExact?: boolean
  onPick: (lat: number, lng: number) => void
}

export function SafeLocationMap({ lat, lng, places = [], hideExact, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const circleRef = useRef<Circle | null>(null)
  const placeMarkers = useRef<Marker[]>([])

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!containerRef.current || mapRef.current) return
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [lat ?? 20.5937, lng ?? 78.9629],
        zoom: lat != null ? 13 : 5,
        zoomControl: false,
        attributionControl: false,
      })
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map)
      L.control.zoom({ position: 'bottomright' }).addTo(map)

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        onPick(e.latlng.lat, e.latlng.lng)
      })

      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 80)
      window.setTimeout(() => map.invalidateSize(), 320)
    }
    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
      placeMarkers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function sync() {
      const map = mapRef.current
      if (!map || lat == null || lng == null) return
      const L = (await import('leaflet')).default
      const point = hideExact ? fuzzCoords(lat, lng) : { lat, lng, radius_m: 80 }

      const icon = L.divIcon({
        className: 'haven-loc-marker',
        html: `<div style="position:relative;width:22px;height:22px;">
          <span style="position:absolute;inset:0;border-radius:9999px;background:#d4a574;opacity:.35;animation:havenPulse 1.8s ease-out infinite"></span>
          <span style="position:absolute;inset:4px;border-radius:9999px;background:#d4a574;border:2px solid #f3eee6"></span>
        </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })

      if (markerRef.current) {
        markerRef.current.setLatLng([point.lat, point.lng])
        markerRef.current.setIcon(icon)
      } else {
        markerRef.current = L.marker([point.lat, point.lng], { icon }).addTo(map)
      }

      if (circleRef.current) {
        circleRef.current.setLatLng([point.lat, point.lng])
        circleRef.current.setRadius(point.radius_m)
      } else {
        circleRef.current = L.circle([point.lat, point.lng], {
          radius: point.radius_m,
          color: '#d4a574',
          weight: 1,
          fillColor: '#d4a574',
          fillOpacity: 0.12,
        }).addTo(map)
      }

      placeMarkers.current.forEach((m) => m.remove())
      placeMarkers.current = []
      for (const p of places.slice(0, 5)) {
        const pm = L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: '#f3eee6',
          fillColor: '#60a5fa',
          fillOpacity: 0.9,
          weight: 1,
        })
          .addTo(map)
          .bindTooltip(p.name, { direction: 'top' })
        placeMarkers.current.push(pm as unknown as Marker)
      }

      map.setView([point.lat, point.lng], Math.max(map.getZoom(), 13))
      map.invalidateSize()
    }
    void sync()
  }, [lat, lng, places, hideExact])

  return (
    <div className="haven-map overflow-hidden rounded-2xl border border-ivory/10">
      <style>{`
        @keyframes havenPulse{0%{transform:scale(.75);opacity:.5}70%{transform:scale(1.9);opacity:0}100%{opacity:0}}
        .haven-map .leaflet-control-zoom a{
          background:#14110f!important;color:#f3eee6!important;border:1px solid rgba(243,238,230,.15)!important;
          width:32px!important;height:32px!important;line-height:30px!important;
        }
        .haven-map .leaflet-bar{border:none!important;box-shadow:none!important}
        .haven-map .leaflet-control-attribution{display:none!important}
      `}</style>
      <div ref={containerRef} className="h-[240px] w-full" />
      <p className="bg-void/60 px-3 py-2 text-[10px] tracking-[0.16em] text-muted uppercase">
        Tap to adjust · soft area shown when privacy is on
      </p>
    </div>
  )
}
