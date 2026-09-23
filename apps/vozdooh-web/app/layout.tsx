import type { Metadata } from 'next'
import { getEnv } from '../src/config/env'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(getEnv().siteUrl),
  title: 'VOZDOOH — парфюмерия для дома',
  description: 'Кураторская коллекция премиальных ароматов для дома. Демонстрационный режим до синхронизации с 1С.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
