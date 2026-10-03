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
  return availableLandings(products, 'category').find((item) => item.slug === slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const landing = await getLanding((await params).slug)
  if (!landing) return { title: 'Коллекция не найдена — VOZDOOH', robots: { index: false, follow: false } }
  const seoTitles: Record<string, string> = {
    diffusers: 'Аромадиффузоры для дома — купить в VOZDOOH',
    candles: 'Ароматические свечи для дома — VOZDOOH',
    car: 'Ароматы и ароматизаторы для автомобиля — VOZDOOH',
    sprays: 'Ароматические спреи для дома — VOZDOOH',
    refills: 'Рефилы для диффузоров и ароматов — VOZDOOH',
    accessories: 'Палочки и аксессуары для диффузоров — VOZDOOH',
    'water-soluble': 'Водорастворимые ароматы для диффузоров — VOZDOOH',
    'home-fragrance': 'Ароматы для дома и пространства — VOZDOOH',
    gifts: 'Подарочные наборы ароматов для дома — VOZDOOH',
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
    'home-fragrance': 'Ароматы для дома и пространства',
    gifts: 'Подарочные наборы ароматов для дома',
    professional: 'Профессиональная ароматизация помещений',
  }
  return <CatalogLanding landing={landing} products={landing.products} kind="category" heading={seoHeadings[landing.slug] ?? landing.name} />
}
