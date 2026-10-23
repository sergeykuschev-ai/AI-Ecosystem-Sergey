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

    const frame = window.requestAnimationFrame(() => {
      syncMotion()
      syncVisibility()
      setEnabled(hasWebGL && !lowMemory && !saveData)
    })
    media.addEventListener('change', syncMotion)
    document.addEventListener('visibilitychange', syncVisibility)

    return () => {
      window.cancelAnimationFrame(frame)
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
          type="waterPlane"
          animate={!reduceMotion && pageVisible ? 'on' : 'off'}
          uSpeed={0.095}
          uStrength={2.35}
          uDensity={1.08}
          uFrequency={5.5}
          color1="#6f4c33"
          color2="#a3653d"
          color3="#223129"
          lightType="3d"
          brightness={0.82}
          grain="off"
          grainBlending={0}
          cAzimuthAngle={180}
          cPolarAngle={82}
          cDistance={3.9}
          positionX={-0.2}
          positionY={0.12}
          rotationZ={-18}
          shader="defaults"
        />
      </ShaderGradientCanvas>
    </div>
  )
}
