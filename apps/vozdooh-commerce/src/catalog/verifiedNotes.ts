import type { CatalogProduct } from './contracts'
import { fragranceFactsFor } from './fragranceFacts'

export const noteNames = {
  vanilla: 'ванили', oud: 'уда', sandalwood: 'сандала', bergamot: 'бергамота', fig: 'инжира',
} as const
export type VerifiedNote = keyof typeof noteNames

type NoteEvidence = {
  sku: string; slug: string; brand: string; category: string; fragrance: string
  aliases: readonly string[]; volume: string; notes: readonly VerifiedNote[]
  sourceUrl: string; sourceDocument: string; verifiedOn: string; page?: number
}

const vellutierSource = {
  brand: 'Vellutier', category: 'Свечи',
  sourceUrl: 'https://vellutier.com/vellutier.pdf',
  sourceDocument: 'research/product-seo-2026-10-12.md', verifiedOn: '2026-10-12',
}
const cultiSource = {
  brand: 'CULTI MILANO', category: 'Диффузоры',
  sourceDocument: 'research/demand-priority-2026-09.md', verifiedOn: '2026-09-24',
}

// Explicit SKU/slug/format bindings reviewed in the repository. No name inference.
export const noteEvidence: readonly NoteEvidence[] = [
  { ...vellutierSource, sku: 'V63017', slug: 'vellutier-vintage-library-90', fragrance: 'Vintage Library', aliases: ['Vintage Library', 'Vintege Library'], volume: '90', page: 17, notes: ['vanilla', 'sandalwood'] },
  { ...vellutierSource, sku: 'V63011', slug: 'vellutier-oudwood-journey-90', fragrance: 'Oudwood Journey', aliases: ['Oudwood Journey', 'Удовое дерево'], volume: '90', page: 10, notes: ['oud'] },
  { ...cultiSource, sku: 'df29d344-d192-11ec-be83-7c8bca00854e', slug: 'culti-stile-aramara-250', fragrance: 'Aramara', aliases: ['Aramara'], volume: '250', notes: ['bergamot', 'sandalwood'], sourceUrl: 'https://www.culti.com/it/diffusore-stile-aramara-250ml.html' },
  { ...cultiSource, sku: '802e8ae5-d19b-11ec-be83-7c8bca00854e', slug: 'culti-decor-aramara-250', fragrance: 'Aramara', aliases: ['Aramara'], volume: '250', notes: ['bergamot', 'sandalwood'], sourceUrl: 'https://www.culti.com/en/diffusore-decor-aramara-250ml.html' },
  { ...cultiSource, sku: 'df29d34a-d192-11ec-be83-7c8bca00854e', slug: 'culti-stile-aqqua-250', fragrance: 'Aqqua', aliases: ['Aqqua'], volume: '250', notes: ['bergamot', 'sandalwood'], sourceUrl: 'https://www.culti.com/eu/catalog/product/view/id/3441/s/diffusore-stile-aqqua-250ml-3441/category/21/' },
  { sku: 'DV250TFU', slug: 'teatro-dolce-vaniglia-250', brand: 'TEATRO Fragranze Uniche', category: 'Диффузоры', fragrance: 'Dolce Vaniglia', aliases: ['DOLCE VANIGLIA', 'Dolce Vaniglia'], volume: '250', notes: ['vanilla'], sourceUrl: 'https://teatrofragranzeuniche.it/it/dolce-vaniglia-ml-250-con-bastoncini', sourceDocument: 'research/demand-priority-2026-09.md', verifiedOn: '2026-09-24' },
]

export function verifiedNotesFor(product: CatalogProduct) {
  const evidence = noteEvidence.find(item => item.sku === product.trade.sku && item.slug === product.editorial.slug)
  if (!evidence || product.trade.brand !== evidence.brand || product.trade.category !== evidence.category ||
    !evidence.aliases.some(alias => new RegExp(`(?:^|[^\\p{L}\\p{N}_])${alias}(?![\\p{L}\\p{N}_])`, 'u').test(product.trade.name)) ||
    !new RegExp(`^${evidence.volume}\\s*(?:${evidence.category === 'Свечи' ? 'г|гр|g' : 'мл|ml'})$`, 'iu').test(product.trade.volume?.trim() ?? '') ||
    fragranceFactsFor(product)?.name !== evidence.fragrance) return null
  return {
    ...evidence,
    bindingDocument: 'src/catalog/stagedEditorial.ts',
    bindingReviewedOn: '2026-11-25',
    displayNotes: fragranceFactsFor(product)!.notes,
  }
}
