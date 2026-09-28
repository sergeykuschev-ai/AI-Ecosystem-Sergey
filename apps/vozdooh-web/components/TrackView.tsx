'use client'

import { useEffect } from 'react'
import { trackEvent, type AnalyticsEvent } from '../src/integrations/analytics'

/** Fires a view event once per page mount (item, brand, collection). */
export function TrackView({ event, payload }: { event: AnalyticsEvent; payload?: Record<string, unknown> }) {
  useEffect(() => {
    trackEvent(event, payload)
  }, [event, payload])
  return null
}
