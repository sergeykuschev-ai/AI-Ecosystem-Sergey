/**
 * INTERNAL merchandising signal derived from the checked-in demand research
 * (research/demand-priority-2026-09.{md,csv,json}; external sources verified
 * live on 2026-09-24, see research/demand-priority-2026-09.md).
 *
 * Boundary rules:
 * - Internal ordering signal only. Research tier names and ranks must NEVER be
 *   rendered to customers, and this module must stay a small checked-in mapping
 *   (the 650KB research JSON is not imported into the client bundle).
 * - `rank` covers exactly the 25 researched TOP SKUs, all with current positive
 *   stock, and equals the research `promotion_rank`. Ranks are an internal
 *   sequencing signal; equal-evidence neighbours are not sales predictions.
 * - Only the four CORE fragrances carry an externally confirmed popularity
 *   signal (two independent explicit bestseller statements per fragrance, at
 *   fragrance level, not VOZDOOH sales). The three CULTI Thé SKUs
 *   (46091, 465636, 802e8b01-d19b-11ec-be83-7c8bca00854e) were demoted to the
 *   general queue after the preliminary Bloomingdale's "bestseller" signal
 *   FAILED re-verification on 2026-09-24; they must NOT receive priority or
 *   popularity treatment.
 */

export type DemandPriority = { rank: number }

const demandPriorityBySku: Record<string, DemandPriority> = {
  '802e8ae5-d19b-11ec-be83-7c8bca00854e': { rank: 1 },
  'bf33a951-016c-11ed-b2a4-7c8bca00854e': { rank: 2 },
  'df29d344-d192-11ec-be83-7c8bca00854e': { rank: 3 },
  'df29d346-d192-11ec-be83-7c8bca00854e': { rank: 4 },
  'N020458': { rank: 5 },
  '802e8b0c-d19b-11ec-be83-7c8bca00854e': { rank: 6 },
  '976878': { rank: 7 },
  'bf33a957-016c-11ed-b2a4-7c8bca00854e': { rank: 8 },
  'df29d34a-d192-11ec-be83-7c8bca00854e': { rank: 9 },
  '655467': { rank: 10 },
  'DV250TFU': { rank: 11 },
  'BD500TFU': { rank: 12 },
  'DV500RTFU': { rank: 13 },
  'DANHNIR250DEC': { rank: 14 },
  'N020465': { rank: 15 },
  'FF250TFU': { rank: 16 },
  'ROU250TFU': { rank: 17 },
  'V63011': { rank: 18 },
  'N020291': { rank: 19 },
  'CAND-ROU180': { rank: 20 },
  'DI250TFU': { rank: 21 },
  'FLC250TFU': { rank: 22 },
  'II250TFU': { rank: 23 },
  'V61014': { rank: 24 },
  'V62014': { rank: 25 },
}

/** Research promotion_rank for a SKU, or null when the SKU is not in the researched TOP. */
export function demandRank(sku: string): number | null {
  return demandPriorityBySku[sku]?.rank ?? null
}

/**
 * Fragrance-level popularity confirmed by at least two independent explicit
 * external bestseller statements (Aramara, Tessuto formats in stock).
 * Conservative customer-facing label is derived from this set only.
 */
const externallyConfirmedPopularSkus: ReadonlySet<string> = new Set([
  '802e8ae5-d19b-11ec-be83-7c8bca00854e',
  'bf33a951-016c-11ed-b2a4-7c8bca00854e',
  'df29d344-d192-11ec-be83-7c8bca00854e',
  'df29d346-d192-11ec-be83-7c8bca00854e',
])

/**
 * Customer-facing clarification that must accompany any popularity cue so the
 * claim never reads as VOZDOOH sales statistics.
 */
export const POPULARITY_NOTE = 'Популярность аромата подтверждена внешними источниками; это не рейтинг продаж VOZDOOH.'

/** True only for the four CORE SKUs with externally confirmed fragrance-level popularity. */
export function isExternallyConfirmedPopular(sku: string): boolean {
  return externallyConfirmedPopularSkus.has(sku)
}
