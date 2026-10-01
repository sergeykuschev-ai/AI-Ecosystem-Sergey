import type { CatalogProduct } from './contracts'
import { productPresentation } from './presentation'

function trimSiteUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function absoluteUrl(siteUrl: string, path: string): string {
  const base = trimSiteUrl(siteUrl)
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}

export function productStructuredData(
  product: CatalogProduct,
  image: string,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vozdooh27.ru',
) {
  const display = productPresentation(product)
  const url = absoluteUrl(siteUrl, `/catalog/${product.editorial.slug}`)
  const name = display.russianTitle ? `${display.title} — ${display.russianTitle}` : display.title
  const price = product.trade.price
  const stock = product.trade.stock

  const schemaProduct: Record<string, unknown> = {
    '@type': 'Product',
    '@id': `${url}#product`,
    name,
    url,
    image: [absoluteUrl(siteUrl, image)],
    sku: product.trade.sku,
    category: product.trade.category,
  }

  if (product.trade.brand) schemaProduct.brand = { '@type': 'Brand', name: product.trade.brand }
  if (product.editorial.description) schemaProduct.description = product.editorial.description
  if (product.trade.barcode && /^\d{13}$/.test(product.trade.barcode)) schemaProduct.gtin13 = product.trade.barcode

  if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
    schemaProduct.offers = {
      '@type': 'Offer',
      url,
      priceCurrency: 'RUB',
      price: price.toFixed(2),
      availability: (stock ?? 0) >= 1 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    }
  }

  const breadcrumb = {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumbs`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'VOZDOOH', item: absoluteUrl(siteUrl, '/') },
      { '@type': 'ListItem', position: 2, name: 'Каталог', item: absoluteUrl(siteUrl, '/catalog') },
      { '@type': 'ListItem', position: 3, name, item: url },
    ],
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [schemaProduct, breadcrumb],
  }
}

export function serializeStructuredData(value: unknown): string {
  // Avoid allowing catalog text to terminate the script element.
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function landingStructuredData(input: {
  kind: 'brand' | 'category'
  slug: string
  name: string
  description: string
  products: readonly CatalogProduct[]
  siteUrl?: string
}) {
  const siteUrl = input.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vozdooh27.ru'
  const section = input.kind === 'brand' ? 'brands' : 'categories'
  const sectionName = input.kind === 'brand' ? 'Бренды' : 'Категории'
  const url = absoluteUrl(siteUrl, `/${section}/${input.slug}`)
  const page: Record<string, unknown> = {
    '@type': 'CollectionPage',
    '@id': `${url}#page`,
    url,
    name: input.name,
    description: input.description,
  }
  if (input.kind === 'brand') page.about = { '@type': 'Brand', name: input.name }

  const itemList = {
    '@type': 'ItemList',
    '@id': `${url}#items`,
    itemListElement: input.products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: productPresentation(product).title,
      url: absoluteUrl(siteUrl, `/catalog/${product.editorial.slug}`),
    })),
  }
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumbs`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'VOZDOOH', item: absoluteUrl(siteUrl, '/') },
      { '@type': 'ListItem', position: 2, name: sectionName, item: absoluteUrl(siteUrl, `/${section}`) },
      { '@type': 'ListItem', position: 3, name: input.name, item: url },
    ],
  }
  return { '@context': 'https://schema.org', '@graph': [page, itemList, breadcrumb] }
}
