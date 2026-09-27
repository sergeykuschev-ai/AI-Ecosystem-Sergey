'use client'

import Link from 'next/link'
import { LiquidGlass } from '@dpawlikowski/liquid-glass/react'

export function HeroLiquidGlassButton() {
  return (
    <Link className="heroGlassLink" href="/catalog" aria-label="Смотреть коллекцию">
      <LiquidGlass
        className="heroLiquidGlass"
        intensity="subtle"
        opacity={0.24}
        refractive
        transparency="static"
      >
        <span className="heroLiquidGlassLabel">Смотреть коллекцию</span>
      </LiquidGlass>
    </Link>
  )
}
