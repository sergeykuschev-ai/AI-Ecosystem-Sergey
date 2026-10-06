'use client'

import { useEffect } from 'react'

/**
 * Loads Yandex Metrica only when NEXT_PUBLIC_YANDEX_METRICA_ID is present.
 * Without a configured counter this renders nothing and all analytics hooks
 * stay disabled. No counter ID is ever invented or bundled by default.
 */
export function AnalyticsLoader() {
  useEffect(() => {
    const raw = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID
    if (!raw || typeof window === 'undefined') return
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) return
    if (window.__vozdoohAnalyticsId === id) return

    type YandexQueue = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number }

    window.__vozdoohAnalyticsId = id
    let ym = window.ym as YandexQueue | undefined
    if (!ym) {
      ym = function (...args: unknown[]) {
        ;(ym!.a ??= []).push(args)
      }
      window.ym = ym
    }
    ym.l ??= Date.now()
    ym(id, 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
    })

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = `https://mc.yandex.ru/metrika/tag.js?id=${id}`
    const first = document.getElementsByTagName('script')[0]
    first?.parentNode?.insertBefore(script, first)
  }, [])

  return null
}
