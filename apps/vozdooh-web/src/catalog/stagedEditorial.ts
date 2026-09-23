import type { EditorialProduct, TradeProduct } from './contracts'
import { emptyEditorial } from './repository'

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const has = (name: string, pattern: RegExp) => pattern.test(name.toLowerCase())

export function inferStagedBrand(name: string): string | null {
  if (has(name, /teatro/)) return 'TEATRO Fragranze Uniche'
  if (has(name, /mami milano/)) return 'MAMI MILANO'
  if (has(name, /christian tortu/)) return 'Christian Tortu'
  if (has(name, /vinove/)) return 'VINOVE'
  if (has(name, /woodwick/)) return 'WoodWick'
  if (has(name, /vellutier/)) return 'Vellutier'
  if (has(name, /danhera/)) return 'DANHERA'
  if (has(name, /ladenac/)) return 'Ladenac'
  if (has(name, /aramara|aqqua|tessuto|mediterranea|mareminerale|supreme amber|stile classic|stile limited|stile colours|decor classic|decor limited|décor limited/)) return 'CULTI MILANO'
  if (has(name, /aromagroup|romagroup|картридж ag|картридж аg/)) return 'AROMAgroup'
  return null
}

export function inferStagedCategory(name: string): string {
  if (has(name, /диффузор|аромадиффузор/)) return 'Диффузоры'
  if (has(name, /свеч/)) return 'Свечи'
  if (has(name, /спрей|room spray/)) return 'Спреи для дома'
  if (has(name, /рефилл|рефил |сменный аромат/)) return 'Рефилы'
  if (has(name, /автомобил|vinove|саше для автомобиля|сменный блок ароматизатора/)) return 'Для автомобиля'
  if (has(name, /картридж|аппарат для ароматизации|dispenser|shop 250|shop 300|cafe 1000|hotel 1000/)) return 'Ароматизация помещений'
  if (has(name, /саше|аромапопурри|арома лампы/)) return 'Ароматы для пространства'
  if (has(name, /палочк|ножницы для фитиля|керамическая ваза/)) return 'Аксессуары'
  if (has(name, /набор/)) return 'Подарочные наборы'
  return 'Другое'
}

export function inferStagedVolume(name: string): string | null {
  const ml = name.match(/(\d+(?:[.,]\d+)?)\s*мл\b/i)
  if (ml) return `${ml[1].replace(',', '.')} мл`
  const gr = name.match(/(\d+(?:[.,]\d+)?)\s*(?:гр|г)\b/i)
  return gr ? `${gr[1].replace(',', '.')} г` : null
}

const curated: Record<string, Partial<EditorialProduct>> = {
  'df29d344-d192-11ec-be83-7c8bca00854e': { slug: 'culti-stile-aramara-250', description: 'Цитрусово-древесная композиция с горьким апельсином, бергамотом и сандалом.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
  'df29d346-d192-11ec-be83-7c8bca00854e': { slug: 'culti-stile-tessuto-250', description: 'Мягкая композиция с листьями чёрной смородины и мускусом.', scentFamily: 'fresh', mood: 'calm', room: 'bedroom' },
  'df29d34a-d192-11ec-be83-7c8bca00854e': { slug: 'culti-stile-aqqua-250', description: 'Свежая древесная композиция с бергамотом и сандалом.', scentFamily: 'fresh', mood: 'airy', room: 'living' },
  'df29d34e-d192-11ec-be83-7c8bca00854e': { slug: 'culti-stile-supreme-amber-250', scentFamily: 'warm', mood: 'cozy', room: 'living' },
  '802e8ae5-d19b-11ec-be83-7c8bca00854e': { slug: 'culti-decor-aramara-250', description: 'Цитрусово-древесная композиция с горьким апельсином, бергамотом и сандалом.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
  '802e8adf-d19b-11ec-be83-7c8bca00854e': { slug: 'culti-decor-mediterranea-250', description: 'Средиземноморская цитрусовая композиция с горьким апельсином, лимоном и нероли.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
  '802e8aeb-d19b-11ec-be83-7c8bca00854e': { slug: 'culti-decor-mountain-500', description: 'Древесная композиция с кедром и ветивером.', scentFamily: 'woody', mood: 'calm', room: 'study' },
  '802e8b0c-d19b-11ec-be83-7c8bca00854e': { slug: 'culti-mareminerale-car-sachet', description: 'Морской аккорд и минеральный мускус.', scentFamily: 'fresh', mood: 'airy' },
  'ROU250TFU': { slug: 'teatro-rose-oud-250', description: 'Насыщенная композиция, построенная вокруг уда и дамасской розы.', scentFamily: 'woody', mood: 'cozy', room: 'living' },
  '8c80d0e5-231d-11ef-b412-e92179844ed4': { slug: 'teatro-ceresia-250', description: 'Яркая фруктово-цветочная композиция: в старте вишня, бергамот, лист инжира и миндальное молоко; в базе ваниль, сандал и мускус.', scentFamily: 'floral', mood: 'airy', room: 'living' },
  'CE500TFU.23': { slug: 'teatro-ceresia-500', description: 'Яркая фруктово-цветочная композиция: в старте вишня, бергамот, лист инжира и миндальное молоко; в базе ваниль, сандал и мускус.', scentFamily: 'floral', mood: 'airy', room: 'living' },
}

export function stagedTrade(trade: TradeProduct): TradeProduct {
  return { ...trade, brand: trade.brand ?? inferStagedBrand(trade.name), category: inferStagedCategory(trade.name), volume: trade.volume ?? inferStagedVolume(trade.name), price: null }
}

export function stagedEditorial(trades: readonly TradeProduct[]): Record<string, EditorialProduct> {
  const result: Record<string, EditorialProduct> = {}
  for (const trade of trades) {
    const base = emptyEditorial(trade.sku)
    const patch = curated[trade.sku] ?? {}
    const brand = inferStagedBrand(trade.name)
    const generated = brand ? `${slugify(brand)}-${slugify(trade.sku)}` : base.slug
    result[trade.sku] = { ...base, slug: patch.slug ?? generated, ...patch }
  }
  return result
}
