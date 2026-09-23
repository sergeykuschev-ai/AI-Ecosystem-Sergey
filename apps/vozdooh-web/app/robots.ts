import type { MetadataRoute } from 'next'

/** Demo stage: keep the whole storefront out of search indexes and crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  }
}
