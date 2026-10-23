import { getCatalogRepository } from '../../src/catalog/source'
import { withValidImages } from '../../src/catalog/validImages'
import { buildYandexYml } from '../../src/integrations/yandexFeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const products = await withValidImages(await (await getCatalogRepository()).list())
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vozdooh27.ru'
    return new Response(buildYandexYml(products, siteUrl), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    })
  } catch {
    return new Response('Catalog feed temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
