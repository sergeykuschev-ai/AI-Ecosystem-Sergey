'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const HeroShaderGradientLayer = dynamic(() => import('./HeroShaderGradientLayer'), {
  ssr: false,
  loading: () => null,
})

/**
 * The gradient is a decorative hero layer backed by a large three.js bundle.
 * Mount it only after the browser is idle so the chunk download never competes
 * with critical rendering; reduced-motion/save-data/weak-device fallbacks live
 * in the layer itself.
 */
export function HeroShaderGradient() {
  const [deferred, setDeferred] = useState(false)

  useEffect(() => {
    const schedule = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (typeof schedule === 'function') {
      schedule(() => setDeferred(true), { timeout: 2500 })
    } else {
      const timer = window.setTimeout(() => setDeferred(true), 1200)
      return () => window.clearTimeout(timer)
    }
  }, [])

  if (!deferred) return null
  return <HeroShaderGradientLayer />
}
