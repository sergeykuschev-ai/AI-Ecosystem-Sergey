import type { Metadata } from 'next'
import { AnalyticsLoader } from '../components/AnalyticsLoader'
import { getEnv } from '../src/config/env'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(getEnv().siteUrl),
  title: {
    default: 'VOZDOOH — парфюмерия для дома',
    template: '%s — VOZDOOH',
  },
  description: 'VOZDOOH — каталог ароматов для дома. Подбор по бренду и формату.',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'VOZDOOH',
    title: 'VOZDOOH — парфюмерия для дома',
    description: 'Коллекция ароматов для дома: диффузоры, свечи, спреи и подарочные наборы.',
  },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AnalyticsLoader />
        {children}
      </body>
    </html>
  )
}
