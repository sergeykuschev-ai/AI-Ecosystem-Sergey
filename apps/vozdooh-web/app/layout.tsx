import type { Metadata } from 'next'
import { AnalyticsLoader } from '../components/AnalyticsLoader'
import { getEnv } from '../src/config/env'
import { serializeSiteStructuredData } from '../src/seo/siteStructuredData'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(getEnv().siteUrl),
  title: 'VOZDOOH — парфюмерия для дома',
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
  const structuredData = serializeSiteStructuredData(getEnv().siteUrl)
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
