import type { CatalogProduct } from './contracts'
import { reviewedTitle } from './reviewedContent'
import { merchandisingSignal } from './merchandising'
import { confirmedProductTranslation } from './productTranslations'
import type { RawSearchParams } from './filterParams'
import { categoryLabels, labelFor } from './vocabulary'

export const brandPriority = ['CULTI MILANO', 'TEATRO Fragranze Uniche', 'Millefiori Milano', 'Lothantique', 'Christian Tortu', 'Castelbel', 'DANHERA', 'MAMI MILANO']

// Positive stock in 1C can include legacy technical/non-VOZDOOH items. Keep these
// out of the customer storefront even if a local image is later added by mistake.
export const storefrontExcludedSkus = new Set(['445445'])

export function isStorefrontExcluded(product: CatalogProduct): boolean {
  return storefrontExcludedSkus.has(product.trade.sku)
}

function brandRank(brand: string | null): number {
  const index = brandPriority.indexOf(brand ?? '')
  return index < 0 ? brandPriority.length : index
}

export function isDebugCatalog(params: RawSearchParams): boolean {
  return params.debugCatalog === '1'
}

/** Only local raster assets are supported by the existing image configuration. */
export function catalogImage(product: CatalogProduct): string | null {
  return product.editorial.images.find((image) => /^\/(?!\/)(?:[\w-]+\/)*[\w.-]+\.(?:webp|png|jpe?g|avif)$/i.test(image) && !image.includes('..')) ?? null
}

/** Single public catalog eligibility rule shared by sitemap and product pages.
 * Valid assets are checked upstream with withValidImages before calling this.
 */
/** Positive-stock pictured products can be viewed, even without a final price.
 * Product pages without price remain noindex and cannot be purchased.
 */
export function isPubliclyVisible(product: CatalogProduct): boolean {
  return product.isActive &&
    !isStorefrontExcluded(product) &&
    Boolean(product.editorial.slug) &&
    Boolean(catalogImage(product)) &&
    (product.trade.stock ?? 0) >= 1
}

export function isPubliclyPurchasable(product: CatalogProduct): boolean {
  return isPubliclyVisible(product) &&
    typeof product.trade.price === 'number' &&
    Number.isFinite(product.trade.price) &&
    product.trade.price > 0
}

export function storefrontProducts(products: readonly CatalogProduct[], debug = false): CatalogProduct[] {
  return products.filter((product) => debug || (!isStorefrontExcluded(product) && catalogImage(product))).sort((a, b) => {
    // Internal merchandising signal first: researched higher-priority in-stock
    // products lead the default catalog; the rank itself is never displayed.
    const rankA = merchandisingSignal(a.trade.sku)?.promotionRank ?? null
    const rankB = merchandisingSignal(b.trade.sku)?.promotionRank ?? null
    if (rankA !== rankB) return (rankA ?? Number.MAX_SAFE_INTEGER) - (rankB ?? Number.MAX_SAFE_INTEGER)
    const brand = brandRank(a.trade.brand) - brandRank(b.trade.brand)
    if (brand !== 0) return brand
    const tieA = `${a.editorial.slug ?? ''}\u0000${a.trade.sku}`
    const tieB = `${b.editorial.slug ?? ''}\u0000${b.trade.sku}`
    return tieA < tieB ? -1 : tieA > tieB ? 1 : 0
  })
}

export function curatorSelection(products: readonly CatalogProduct[]): CatalogProduct[] {
  const brands = new Set<string>()
  return storefrontProducts(products).filter((product) => {
    const { description, scentFamily, mood, room } = product.editorial
    const brand = product.trade.brand
    if (!brand || brands.has(brand) || !description || !(scentFamily || mood || room)) return false
    brands.add(brand)
    return true
  }).slice(0, 4)
}

/** Presentation only: the complete source name remains available in product details. */
export function productPresentation(product: CatalogProduct) {
  const { name, brand, volume, category } = product.trade
  let title = name
  const aliases = [brand, brand === 'TEATRO Fragranze Uniche' ? 'TEATRO' : null, brand === 'Ladenac Milano' ? 'Ladenac' : null].filter(Boolean) as string[]
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`(^|[\\s/,])${escaped}(?=$|[\\s/,])`, 'gi'), '$1')
  }
  title = title
    .replace(/^Hydro\s*\/\s*концентрат для арома лампы\s*/i, '')
    .replace(/(?<![\p{L}\p{N}_])(?:диффузор с палочками|рефилл? для (?:заправки )?диффузора|спрей для дома|аромадиффузор|ароматическая свеча|свеча (?:большая|маленькая|средняя)|сменный аромат для аромапопурри|сменный аромат|аромапопурри|ароматизатор воздуха|ароматическое саше|диффузор|room spray)(?![\p{L}\p{N}_])/giu, (match, offset, source) => {
      // A type following a preposition describes the object, not redundant packaging.
      return /(?:^|\s)(?:для|с|со|в|во|из|на)\s+$/iu.test(source.slice(0, offset)) ? match : ''
    })
    .replace(/(?<![\p{L}\p{N}_])кар?тридж\s+[aа]g(?![\p{L}\p{N}_])/giu, '')
    .replace(/(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)?\s*(?:мл|ml|гр|г)(?=\s|[.,/]|$)/giu, (match) => category === 'Аксессуары' ? match : '')
    .replace(/[,\s]*(?:пласт\.|пластик|ТМ)\s*$/gi, '')
    .replace(/^[\s/,]+|[\s/,.]+$/g, '')
    .replace(/\s+/g, ' ')
  // A bilingual label carries the same fragrance twice. Keep the first named part.
  title = title.split('/').map((part) => part.trim()).find(Boolean) ?? name
  title = title.replace(/[,.]?\s*(?:Luxury [CС]ollection|Christmas Collection|Коллекция .*)$/i, '').trim()
  const translation = confirmedProductTranslation(product.trade)
  return {
    title: reviewedTitle(product.trade) ?? translation?.original ?? (title || name),
    russianTitle: translation?.russian ?? null,
    subtitle: [labelFor(categoryLabels, category), category === 'Аксессуары' ? null : volume ?? name.match(/\d+(?:[.,]\d+)?\s*ml\b/i)?.[0]].filter(Boolean).join(' · '),
  }
}

/**
 * A small reviewed variant-disambiguation rule for actual 1C variants with
 * equal display names. Never guess a size from the slug: verify trade.volume
 * and the original 1C name before appending it to the H1 and Product schema.
 */
const verifiedCleaningFluidVolumes: Readonly<Record<string, string>> = {
  'aromagroup-cleaning-fluid-110': '110 мл',
  'aromagroup-cleaning-fluid-150': '150 мл',
}

// Issue #271: only these two publicly verified 1C records authorize a suffix.
const verifiedAramaraVariants: Readonly<Record<string, { sku: string; name: string; volume: string }>> = {
  'culti-decor-aramara-1000': {
    sku: 'bf33a951-016c-11ed-b2a4-7c8bca00854e',
    name: 'Decor Classic диффузор Aramara 1000 мл',
    volume: '1000 мл',
  },
  'culti-decor-aramara-250': {
    sku: '802e8ae5-d19b-11ec-be83-7c8bca00854e',
    name: 'Decor Classic диффузор Aramara 250мл',
    volume: '250 мл',
  },
}

export function productPageHeading(product: CatalogProduct): string {
  const title = productPresentation(product).title
  const aramara = verifiedAramaraVariants[product.editorial.slug]
  if (aramara && product.trade.sku === aramara.sku &&
    product.trade.name === aramara.name && product.trade.volume?.trim() === aramara.volume) {
    return title.includes(aramara.volume) ? title : `${title} ${aramara.volume}`
  }
  const expectedVolume = verifiedCleaningFluidVolumes[product.editorial.slug]
  if (!expectedVolume || product.trade.volume?.trim() !== expectedVolume) return title
  const numeric = expectedVolume.split(' ')[0]
  if (!new RegExp('(?:^|\\D)' + numeric + '\\s*мл(?:\\D|$)', 'iu').test(product.trade.name)) return title
  return title.includes(expectedVolume) ? title : `${title} ${expectedVolume}`
}

/** Navigation by exact trade brand only; never a fragrance or compatibility claim.
 * Call with image-validated catalog records. Explicit editorial links suppress fallback,
 * including when their targets are unavailable.
 */
export function sameBrandProducts(products: readonly CatalogProduct[], product: CatalogProduct): CatalogProduct[] {
  if (!product.trade.brand || product.editorial.recommendations.length > 0) return []
  return storefrontProducts(products).filter((item) => item.isActive && item.id !== product.id &&
    item.trade.brand === product.trade.brand && (item.trade.stock ?? 0) > 0).slice(0, 3)
}
