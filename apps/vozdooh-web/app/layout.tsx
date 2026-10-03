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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const siteUrl = getEnv().siteUrl.replace(/\/+$/, '')
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${siteUrl}/#website`, url: siteUrl, name: 'VOZDOOH', inLanguage: 'ru-RU' },
      { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: 'VOZDOOH', url: siteUrl },
    ],
  }).replace(/</g, '\u003c')
  return (
    <html lang="ru">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
        <AnalyticsLoader />
        {children}
      </body>
    </html>
  )
}
