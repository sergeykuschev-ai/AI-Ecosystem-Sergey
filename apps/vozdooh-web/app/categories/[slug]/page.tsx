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
  const landing = availableLandings(products, 'category').find((item) => item.slug === slug)
  return landing ? { ...landing, description: landingSearchDescription(landing, landing.products, 'category') } : undefined
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const landing = await getLanding((await params).slug)
  if (!landing) return { title: 'Коллекция не найдена — VOZDOOH', robots: { index: false, follow: false } }
  const seoTitles: Record<string, string> = {
    diffusers: 'Аромадиффузоры — купить с доставкой по России | VOZDOOH',
    candles: 'Ароматические свечи — купить с доставкой по России | VOZDOOH',
    car: 'Ароматы для автомобиля — купить с доставкой по России | VOZDOOH',
    sprays: 'Ароматические спреи для дома — доставка по России | VOZDOOH',
    refills: 'Рефилы для диффузоров — купить с доставкой по России | VOZDOOH',
    accessories: 'Палочки и аксессуары для диффузоров — купить в VOZDOOH',
    'water-soluble': 'Водорастворимые ароматы для диффузоров — купить в VOZDOOH',
    'home-fragrance': 'Саше и аромапопурри для дома — купить в VOZDOOH',
    gifts: 'Подарочные наборы ароматов — доставка по России | VOZDOOH',
    professional: 'Профессиональная ароматизация помещений — VOZDOOH',
  }
  const title = seoTitles[landing.slug] ?? `${landing.name} — VOZDOOH`
  return { title, description: landing.description,
    openGraph: { title, description: landing.description },
    alternates: { canonical: landingPath('category', landing.slug) }, robots: publicRobots() }
}

export default async function LandingPage({ params }: Props) {
  const landing = await getLanding((await params).slug)
  if (!landing) notFound()
  const seoHeadings: Record<string, string> = {
    diffusers: 'Аромадиффузоры для дома',
    candles: 'Ароматические свечи для дома',
    car: 'Ароматы для автомобиля',
    sprays: 'Ароматические спреи для дома',
    refills: 'Рефилы для диффузоров',
    accessories: 'Аксессуары для диффузоров',
    'water-soluble': 'Водорастворимые ароматы',
    'home-fragrance': 'Саше и аромапопурри для дома',
    gifts: 'Подарочные наборы ароматов для дома',
    professional: 'Профессиональная ароматизация помещений',
  }
  return <CatalogLanding landing={landing} products={landing.products} kind="category" heading={seoHeadings[landing.slug] ?? landing.name} />
}
