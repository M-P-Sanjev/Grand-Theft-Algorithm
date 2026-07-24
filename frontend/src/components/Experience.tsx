'use client'

import { AppProvider } from '@/components/providers/AppProvider'
import { SmoothScroll } from '@/components/providers/SmoothScroll'
import { LoadingCinematic } from '@/components/effects/LoadingCinematic'
import { AudioEngine } from '@/components/audio/AudioEngine'
import { Navbar } from '@/components/nav/Navbar'
import { HeroOverlay } from '@/components/hero/Hero'
import { SearchExperience } from '@/components/sections/SearchExperience'
import { MenuCatalogue } from '@/components/sections/MenuCatalogue'
import { OrderTracking } from '@/components/sections/OrderTracking'
import { Footer } from '@/components/sections/Footer'

export function Experience() {
  return (
    <AppProvider>
      <SmoothScroll>
        <LoadingCinematic />
        <AudioEngine />
        <Navbar />
        <main className="relative z-10">
          <HeroOverlay />
          <SearchExperience />
          <MenuCatalogue />
          <OrderTracking />
        </main>
        <Footer />
      </SmoothScroll>
    </AppProvider>
  )
}
