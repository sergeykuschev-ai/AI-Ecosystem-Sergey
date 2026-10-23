'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { trackEvent } from '../src/integrations/analytics'

const FILTER_KEYS = ['brand', 'category', 'family', 'mood', 'room'] as const

/** Reports catalog filter usage from the URL state after navigation. */
export function FilterTracker() {
  const searchParams = useSearchParams()
  const lastKey = useRef<string | null>(null)

  useEffect(() => {
    const active = FILTER_KEYS.filter((key) => searchParams.get(key))
    if (active.length === 0) {
      lastKey.current = null
      return
    }
    const key = searchParams.toString()
    if (key === lastKey.current) return
    lastKey.current = key
    trackEvent('filter_use', Object.fromEntries(active.map((name) => [name, searchParams.get(name)])))
  }, [searchParams])

  return null
}
