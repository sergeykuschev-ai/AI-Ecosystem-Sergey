import type { CatalogProduct } from './contracts'

/** Exact SKU allowlist from demand-priority-2026-09.csv; external evidence checked
 * 2026-09-24. Positive SKU/stock/original-name set reverified 2026-10-12:
 * 148 SKU / 220 units. Internal metadata only; no research JSON in bundles. */
export type MerchandisingSignal = { promotionRank: number; demandTier: 'CORE' | 'STRONG'; fragrance: string }
const signals: Readonly<Record<string, MerchandisingSignal>> = {
  '802e8ae5-d19b-11ec-be83-7c8bca00854e': { promotionRank: 1, demandTier: 'CORE', fragrance: "CULTI MILANO / Aramara" },
  'bf33a951-016c-11ed-b2a4-7c8bca00854e': { promotionRank: 2, demandTier: 'CORE', fragrance: "CULTI MILANO / Aramara" },
  'df29d344-d192-11ec-be83-7c8bca00854e': { promotionRank: 3, demandTier: 'CORE', fragrance: "CULTI MILANO / Aramara" },
  'df29d346-d192-11ec-be83-7c8bca00854e': { promotionRank: 4, demandTier: 'CORE', fragrance: "CULTI MILANO / Tessuto" },
  'N020458': { promotionRank: 5, demandTier: 'STRONG', fragrance: "Lothantique / LES SECRETS D'ANTOINE" },
  '802e8b0c-d19b-11ec-be83-7c8bca00854e': { promotionRank: 6, demandTier: 'STRONG', fragrance: "CULTI MILANO / Mareminerale" },
  '976878': { promotionRank: 7, demandTier: 'STRONG', fragrance: "CULTI MILANO / Aqqua" },
  'bf33a957-016c-11ed-b2a4-7c8bca00854e': { promotionRank: 8, demandTier: 'STRONG', fragrance: "CULTI MILANO / Aqqua" },
  'df29d34a-d192-11ec-be83-7c8bca00854e': { promotionRank: 9, demandTier: 'STRONG', fragrance: "CULTI MILANO / Aqqua" },
  '655467': { promotionRank: 10, demandTier: 'STRONG', fragrance: "TEATRO Fragranze Uniche / DOLCE VANIGLIA" },
  'DV250TFU': { promotionRank: 11, demandTier: 'STRONG', fragrance: "TEATRO Fragranze Uniche / DOLCE VANIGLIA" },
  'BD500TFU': { promotionRank: 12, demandTier: 'STRONG', fragrance: "TEATRO Fragranze Uniche / BIANCO DIVINO" },
  'DV500RTFU': { promotionRank: 13, demandTier: 'STRONG', fragrance: "TEATRO Fragranze Uniche / DOLCE VANIGLIA" },
  'DANHNIR250DEC': { promotionRank: 14, demandTier: 'STRONG', fragrance: "DANHERA / NIRO" },
}

export const highStockPushSkus: ReadonlySet<string> = new Set(["N020434", "BAST500NTFU", "32131", "445445", "N020486", "08d97776-bb50-11ef-b425-ed110731e4f3", "63a36c45-bb50-11ef-b425-ed110731e4f3", "83763644-bb50-11ef-b425-ed110731e4f3", "0b044a39-8588-11ed-b530-7c8bca00854e"])

export function merchandisingSignal(sku: string): MerchandisingSignal | null { return signals[sku] ?? null }
export function hasBestsellerEvidence(sku: string): boolean { return signals[sku]?.demandTier === 'CORE' }
export function isStrongPopular(sku: string): boolean { return signals[sku]?.demandTier === 'STRONG' }

export function priorityProducts(products: readonly CatalogProduct[]): CatalogProduct[] {
  return [...products].sort((a, b) => (signals[a.trade.sku]?.promotionRank ?? Infinity) - (signals[b.trade.sku]?.promotionRank ?? Infinity))
}

export function merchProducts(products: readonly CatalogProduct[], set: 'bestsellers' | 'strong' | 'popular' | 'high-stock'): CatalogProduct[] {
  return priorityProducts(products.filter((p) => (p.trade.stock ?? 0) > 0 && (
    set === 'high-stock' ? highStockPushSkus.has(p.trade.sku) :
    set === 'bestsellers' ? hasBestsellerEvidence(p.trade.sku) :
    set === 'strong' ? isStrongPopular(p.trade.sku) : merchandisingSignal(p.trade.sku) !== null
  )))
}

/** One representative per fragrance; volumes/formats remain linked on the PDP. */
export function diverseMerchProducts(products: readonly CatalogProduct[]): CatalogProduct[] {
  const seen = new Set<string>()
  return products.filter((p) => {
    const key = signals[p.trade.sku]?.fragrance ?? p.trade.sku
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Home-fragrance shelf: independently researched and currently stocked home formats only.
 * Automotive sachets, refills and consumables remain in the full catalog.
 */
export function homePopularProducts(products: readonly CatalogProduct[]): CatalogProduct[] {
  const forHome = merchProducts(products, 'popular').filter(product =>
    product.trade.category === 'Диффузоры' || product.trade.category === 'Свечи'
  )
  return diverseMerchProducts(forHome).slice(0, 6)
}

export const MERCHANDISING_NOTE = 'Выбор по подтверждённым сигналам независимых продавцов; не статистика продаж VOZDOOH.'
