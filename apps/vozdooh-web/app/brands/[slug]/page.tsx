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
  return availableLandings(products, 'brand').find((item) => item.slug === slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const landing = await getLanding((await params).slug)
  if (!landing) return { title: 'Коллекция не найдена — VOZDOOH', robots: { index: false, follow: false } }
  const seoTitles: Record<string, string> = {
    'culti-milano': 'CULTI MILANO в Хабаровске — купить | VOZDOOH',
    'teatro-fragranze-uniche': 'TEATRO Fragranze Uniche в Хабаровске — купить | VOZDOOH',
    lothantique: 'Lothantique в Хабаровске — купить ароматы | VOZDOOH',
    'millefiori-milano': 'Millefiori Milano — купить ароматы для дома | VOZDOOH',
  }
  const seoDescriptions: Record<string, string> = {
    'culti-milano': 'Купить CULTI MILANO в Хабаровске: Aramara, Tessuto, Aqqua и другие ароматы из актуального наличия VOZDOOH. Цены, онлайн-заказ и доставка по России.',
    'teatro-fragranze-uniche': 'Купить TEATRO Fragranze Uniche в Хабаровске: Dolce Vaniglia, Bianco Divino, Rose Oud, диффузоры, свечи и рефилы. Онлайн-заказ и доставка по России.',
    lothantique: 'Купить Lothantique в Хабаровске: Les Secrets d’Antoine, Sandalwood и другие ароматы для дома из актуального наличия VOZDOOH. Доставка по России.',
    'millefiori-milano': 'Купить ароматы для дома Millefiori Milano в VOZDOOH. Актуальное наличие, цены и заказ онлайн с доставкой.',
  }
  const title = seoTitles[landing.slug] ?? `${landing.name} — ароматы для дома | VOZDOOH`
  const description = seoDescriptions[landing.slug] ?? landing.description
  return { title, description,
    openGraph: { title, description },
    alternates: { canonical: landingPath('brand', landing.slug) }, robots: publicRobots() }
}

export default async function LandingPage({ params }: Props) {
  const landing = await getLanding((await params).slug)
  if (!landing) notFound()
  return <CatalogLanding landing={landing} products={landing.products} kind="brand" />
}
