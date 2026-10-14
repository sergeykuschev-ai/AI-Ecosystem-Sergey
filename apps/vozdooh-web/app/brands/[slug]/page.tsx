import { landingSearchDescription } from '../../../src/seo/landingCopy'
import type { Metadata } from 'next'
import { publicRobots } from '../../../src/seo/indexing'
import { notFound } from 'next/navigation'
import { CatalogLanding } from '../../../components/CatalogLanding'
import { availableLandings, landingPath } from '../../../src/catalog/landings'
import { getCatalogRepository } from '../../../src/catalog/source'
import { withValidImages } from '../../../src/catalog/validImages'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }> }

async function getLanding(slug: string) {
  const products = await withValidImages(await (await getCatalogRepository()).list())
  const landing = availableLandings(products, 'brand').find((item) => item.slug === slug)
  return landing ? { ...landing, description: landingSearchDescription(landing, landing.products, 'brand') } : undefined
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const landing = await getLanding((await params).slug)
  if (!landing) return { title: 'Коллекция не найдена — VOZDOOH', robots: { index: false, follow: false } }
  const seoTitles: Record<string, string> = {
    'culti-milano': 'CULTI MILANO — купить с доставкой по России | VOZDOOH',
    'teatro-fragranze-uniche': 'TEATRO Fragranze Uniche — купить с доставкой по России | VOZDOOH',
    lothantique: 'Lothantique — купить с доставкой по России | VOZDOOH',
    'millefiori-milano': 'Millefiori Milano — купить ароматы для дома | VOZDOOH',
  }
  const title = seoTitles[landing.slug] ?? `${landing.name} — каталог бренда из наличия | VOZDOOH`
  const description = landing.description
  return { title, description,
    openGraph: { title, description },
    alternates: { canonical: landingPath('brand', landing.slug) }, robots: publicRobots() }
}

export default async function LandingPage({ params }: Props) {
  const landing = await getLanding((await params).slug)
  if (!landing) notFound()
  return <CatalogLanding landing={landing} products={landing.products} kind="brand" />
}
