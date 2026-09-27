'use client'

import dynamic from 'next/dynamic'

const HeroShaderGradientLayer = dynamic(() => import('./HeroShaderGradientLayer'), {
  ssr: false,
  loading: () => null,
})

export function HeroShaderGradient() {
  return <HeroShaderGradientLayer />
}
