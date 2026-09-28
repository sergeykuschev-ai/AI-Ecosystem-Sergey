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

    window.__vozdoohAnalyticsId = id
    window.ym = window.ym ?? function (...args: unknown[]) {
      // Minimal queue shim until the counter script defines window.ym.
      ;((window as unknown as { __ym_queue?: unknown[] }).__ym_queue ??= []).push(args)
    }

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = 'https://mc.yandex.ru/metrika/tag.js'
    const first = document.getElementsByTagName('script')[0]
    first?.parentNode?.insertBefore(script, first)
  }, [])

  return null
}
