import type { EditorialProduct, TradeProduct } from './contracts'
import { emptyEditorial } from './repository'

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const has = (name: string, pattern: RegExp) => pattern.test(name.toLowerCase())

export function inferStagedBrand(name: string): string | null {
  if (has(name, /teatro/)) return 'TEATRO Fragranze Uniche'
  if (has(name, /mami milano/)) return 'MAMI MILANO'
  if (has(name, /christian tortu/)) return 'Christian Tortu'
  if (has(name, /butterflies|coconut ароматическое саше|цветы хлопка \/ cotton flower ароматическое саше/)) return 'Castelbel'
  if (has(name, /les secrets d.antoine|flowersof japan|cottonflower|cotton flower|sandalwood|ambre\/амбра/)) return 'Lothantique'
  if (has(name, /vinove|silverstone|maranello|miami|paris \/ париж/)) return 'VINOVE'
  if (has(name, /hydro\/концентрат.*цветок мимозы/)) return 'Millefiori Milano'
  if (has(name, /woodwick/)) return 'WoodWick'
  if (has(name, /vellutier/)) return 'Vellutier'
  if (has(name, /danhera/)) return 'DANHERA'
  if (has(name, /ladenac|africa |oud collection|urban senses|vent d.arabie|dynastie senteur royale/)) return 'Ladenac Milano'
  if (has(name, /aramara|aqqua|tessuto|mediterranea|mareminerale|supreme amber|stile classic|stile limited|stile colours|decor classic|decor limited|décor limited|спрей для дома\s+era|спрей для дома\s+the|рефил.*\bthe\b/)) return 'CULTI MILANO'
  if (has(name, /aromagroup|romagroup|картридж ag|картридж аg|катридж ag|магма, 150/)) return 'AROMAgroup'
  return null
}

export function inferStagedCategory(name: string): string {
  if (has(name, /подарочный набор|набор ваза/)) return 'Подарочные наборы'
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
  'ROU250TFU': { slug: 'teatro-rose-oud-250', images: ['/catalog/official/ROU250TFU.png'], description: 'Насыщенная композиция, построенная вокруг уда и дамасской розы.', scentFamily: 'woody', mood: 'cozy', room: 'living' },
  '8c80d0e5-231d-11ef-b412-e92179844ed4': { slug: 'teatro-ceresia-250', description: 'Яркая фруктово-цветочная композиция: в старте вишня, бергамот, лист инжира и миндальное молоко; в базе ваниль, сандал и мускус.', scentFamily: 'floral', mood: 'airy', room: 'living' },
  'CE500TFU.23': { slug: 'teatro-ceresia-500', description: 'Яркая фруктово-цветочная композиция: в старте вишня, бергамот, лист инжира и миндальное молоко; в базе ваниль, сандал и мускус.', scentFamily: 'floral', mood: 'airy', room: 'living' },
  'DV250TFU': { slug: 'teatro-dolce-vaniglia-250', images: ['/catalog/official/DV250TFU.png'], description: 'Гурманская ваниль с сахарной пудрой, тёмным шоколадом и карамелью.', scentFamily: 'warm', mood: 'cozy', room: 'living' },
  'FF250TFU': { slug: 'teatro-foglie-di-fico-250', images: ['/catalog/official/FF250TFU.png'], description: 'Зелёные листья инжира, смягчённые ландышем, цитрусовыми и древесными оттенками.', scentFamily: 'fresh', mood: 'calm', room: 'living' },
  'VM250TFU': { slug: 'teatro-vento-di-mare-250', description: 'Морская композиция с мускусом, мягкими морскими нотами и жасмином.', scentFamily: 'fresh', mood: 'airy', room: 'living' },
  '3232434': { slug: 'ladenac-urban-senses-caviar-lime-500', images: ['/catalog/official/3232434.jpg'], description: 'Свежая цитрусово-морская композиция вокруг австралийского finger lime, с бергамотом, морскими оттенками и древесной базой.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
  '55777': { slug: 'ladenac-africa-predator-set', description: 'Коллекция Africa: экзотическая композиция Predator с пряностями, дикими цветами, древесиной, ладаном и миррой.', scentFamily: 'spicy', mood: 'focused', room: 'living' },
  '983858': { slug: 'ladenac-vent-arabie-chergui-500', description: 'Свежая древесно-цитрусовая композиция с лимоном, перцем, петитгрейном, кедром и ветивером.', scentFamily: 'woody', mood: 'focused', room: 'living' },
  '382873': { slug: 'castelbel-butterflies-diffuser-250', images: ['/catalog/official/382873.jpg'], description: 'Свежая цитрусовая композиция сахарного тростника и лемонграсса.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
  '382777': { slug: 'castelbel-cotton-flower-sachet', description: 'Чистый, мягкий и успокаивающий аромат хлопка, напоминающий свежее бельё.', scentFamily: 'floral', mood: 'calm', room: 'bedroom' },
  '382784': { slug: 'castelbel-coconut-sachet', description: 'Кремовый кокосовый аромат для небольших пространств, гардероба и текстиля.', scentFamily: 'warm', mood: 'cozy', room: 'bedroom' },
  'N020465': { slug: 'lothantique-sandalwood-diffuser-200', description: 'Тёплая древесная композиция с пряным вступлением, мускусным сердцем и сандаловой древесной базой.', scentFamily: 'woody', mood: 'cozy', room: 'living' },
  'N020468': { slug: 'lothantique-cotton-flower-diffuser-200', description: 'Мягкая композиция цветка хлопка: роза, альдегидные ноты и мускус.', scentFamily: 'floral', mood: 'calm', room: 'bedroom' },
  'N020469': { slug: 'lothantique-flowers-of-japan-diffuser-200', description: 'Лёгкая цветочная композиция с мандарином, цветущей вишней и мускусом.', scentFamily: 'floral', mood: 'airy', room: 'living' },
  'N020458': { slug: 'lothantique-les-secrets-antoine-diffuser-200', description: 'Французский интерьерный аромат линии Les Secrets d’Antoine, созданный парфюмерами в Грассе.', scentFamily: 'spicy', mood: 'cozy', room: 'study' },
  'N020480': { slug: 'lothantique-cotton-flower-refill-200', description: 'Рефилл аромата Cotton Flower с мягкими нотами розы, альдегидов и мускуса.', scentFamily: 'floral', mood: 'calm', room: 'bedroom' },
  '089864': { slug: 'ladenac-dynastie-senteur-royale-500', description: 'Восточно-пряная композиция сухой амбры, чёрного перца, мускатного ореха, кедра, мирры, мёда, ванили и ладана.', scentFamily: 'spicy', mood: 'cozy', room: 'living' },
  '22fimr': { slug: 'millefiori-mimosa-flower-hydro-15', images: ['/catalog/official/22fimr.jpg'], description: 'Водорастворимый аромат для ультразвуковых диффузоров Hydro: чёрный перец и лист фиалки, мимоза и мате, пачули и бобы тонка.', scentFamily: 'floral', mood: 'calm', room: 'study' },
  '12132': { slug: 'culti-era-room-spray-100', description: 'Фруктово-цветочная композиция с чёрной смородиной, черникой, розой, растительной амброй и кедром.', scentFamily: 'floral', mood: 'cozy', room: 'living' },
  '46091': { slug: 'culti-the-room-spray-100', description: 'Аромат Thé с зелёным чаем сенча и древесиной гваяка.', scentFamily: 'fresh', mood: 'focused', room: 'study' },
  '465636': { slug: 'culti-the-refill-1000', description: 'Рефилл аромата Thé с зелёным чаем сенча и древесиной гваяка.', scentFamily: 'fresh', mood: 'focused', room: 'study' },
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
