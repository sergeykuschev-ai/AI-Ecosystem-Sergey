'use client'

import { useEffect, useState } from 'react'
import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'

type NavigatorHints = Navigator & {
  deviceMemory?: number
  connection?: { saveData?: boolean }
}

export default function HeroShaderGradientLayer() {
  const [enabled, setEnabled] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(true)
  const [pageVisible, setPageVisible] = useState(true)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const nav = navigator as NavigatorHints
    const canvas = document.createElement('canvas')
    const hasWebGL = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
    const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2
    const saveData = Boolean(nav.connection?.saveData)

    const syncMotion = () => setReduceMotion(media.matches)
    const syncVisibility = () => setPageVisible(document.visibilityState !== 'hidden')

    syncMotion()
    syncVisibility()
    setEnabled(hasWebGL && !lowMemory && !saveData)
    media.addEventListener('change', syncMotion)
    document.addEventListener('visibilitychange', syncVisibility)

    return () => {
      media.removeEventListener('change', syncMotion)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [])

  if (!enabled) return null

  return (
    <div className="heroShader" aria-hidden="true">
      <ShaderGradientCanvas
        style={{ position: 'absolute', inset: 0 }}
        pixelDensity={0.8}
        fov={45}
        pointerEvents="none"
        lazyLoad={false}
        powerPreference="low-power"
      >
        <ShaderGradient
          control="props"
          type="plane"
          animate={!reduceMotion && pageVisible ? 'on' : 'off'}
          uSpeed={0.12}
          uStrength={2.25}
          uDensity={1.05}
          uFrequency={4.25}
          color1="#e8d7b7"
          color2="#b67a42"
          color3="#26382d"
          lightType="3d"
          brightness={1.05}
          grain="on"
          grainBlending={0.12}
          cAzimuthAngle={165}
          cPolarAngle={88}
          cDistance={4.8}
          positionX={-0.55}
          positionY={-0.05}
          rotationZ={28}
          shader="defaults"
        />
      </ShaderGradientCanvas>
    </div>
  )
}
