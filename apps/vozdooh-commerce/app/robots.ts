import type { MetadataRoute } from 'next'
import { searchIndexingEnabled } from '../src/seo/indexing'

/** Preview stage: keep the whole storefront out of search indexes and crawlers.
 * The sitemap is wired for the production cut-over; crawling stays disallowed
 * until the owner approves public indexing. */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vozdooh27.ru').replace(/\/+$/, '')
  return {
    rules: searchIndexingEnabled()
      ? { userAgent: '*', allow: '/', disallow: ['/api/', '/cart', '/checkout'] }
      : { userAgent: '*', disallow: '/' },
    sitemap: `${base}/sitemap.xml`,
  }
}
