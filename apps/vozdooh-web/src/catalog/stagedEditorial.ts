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
  if (has(name, /палоч|ножницы для фитиля|керамическая ваза|сетевое з\/у|microusb/)) return 'Аксессуары'
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
  'VM250TFU': { slug: 'teatro-vento-di-mare-250', images: ['/catalog/official/VM250TFU.png'], description: 'Морская композиция с водорослями, дыней и лимоном, сердцем из жасмина, герани и цикламена и базой белого мускуса и сандала.', scentFamily: 'fresh', mood: 'airy', room: 'living' },
  'II250TFU': { slug: 'teatro-incenso-imperiale-250', images: ['/catalog/official/II250TFU.png'], description: 'Тёплая древесно-пряная композиция ладана, уда и фиалки с кедром, бамбуком, ветивером, белым мускусом и тонка.', scentFamily: 'woody', mood: 'focused', room: 'study' },
  'FLC250TFU': { slug: 'teatro-fiore-250', images: ['/catalog/official/FLC250TFU.png'], description: 'Белые цветы — гардения, нарцисс и жасмин — раскрываются фрэнжипани и розой на мягкой мускусной базе.', scentFamily: 'floral', mood: 'airy', room: 'living' },
  'BD500TFU': { slug: 'teatro-bianco-divino-500', images: ['/catalog/official/BD500TFU.png'], description: 'Игристая композиция винограда Champagne, яблока и цитрусов с болгарской розой, глицинией, фиалкой, белым мускусом, бамбуком и сандалом.', scentFamily: 'floral', mood: 'airy', room: 'living' },
  'DI250TFU': { slug: 'teatro-diamante-250', images: ['/catalog/official/DI250TFU.png'], description: 'Пудрово-амбровая композиция с кристаллами сахара и шафраном, современными амбровыми аккордами, кедром и сибирской пихтой.', scentFamily: 'warm', mood: 'focused', room: 'study' },
  'AG250TFU': { slug: 'teatro-borgo-degli-agrumi-250', images: ['/catalog/official/AG250TFU.png'], description: 'Энергичная цитрусовая композиция грейпфрута, бергамота, лимона, апельсина и лайма с лавандой, розой, жасмином и розмарином.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
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
  'MF-FRAGR2.06': { slug: 'mami-nuvola-di-cotone-200', images: ['/catalog/official/MF-FRAGR2.06.png'], description: 'Бергамот, лимон и чёрная смородина переходят в боярышник, жасмин и розу; в базе — ладан и драгоценные древесные ноты.', scentFamily: 'floral', mood: 'calm', room: 'bedroom' },
  'MF-FRAGR2.11': { slug: 'mami-fumo-di-londra-200', images: ['/catalog/official/MF-FRAGR2.11.png'], description: 'Водные ноты и бергамот раскрываются белым шалфеем и иланг-илангом, затем переходят в пачули и светлую древесину.', scentFamily: 'fresh', mood: 'focused', room: 'study' },
  'MF-FRAGR2.01': { slug: 'mami-ghiaccio-e-zenzero-200', images: ['/catalog/official/MF-FRAGR2.01.png'], description: 'Лимон и пряный имбирь соединяются с эвкалиптом, жасмином и цветами миндаля; в базе — корица и кедр.', scentFamily: 'spicy', mood: 'focused', room: 'living' },
  'MF-FRAGR2.02': { slug: 'mami-arancia-candita-200', images: ['/catalog/official/MF-FRAGR2.02.png'], description: 'Яркие апельсин и лимон смягчены цветами апельсина; пряные и древесные акценты добавляют глубину и стойкость.', scentFamily: 'citrus', mood: 'airy', room: 'living' },
  'MF-FRAGR2.07': { slug: 'mami-aqua-200', images: ['/catalog/official/MF-FRAGR2.07.png'], description: 'Мята, лаванда и морской бриз переходят в жасмин, табачный лист и розмарин; база построена на амбре, сосне и дубовом мхе.', scentFamily: 'fresh', mood: 'airy', room: 'living' },
  'MF-FRAGR2.09': { slug: 'mami-vaniglia-e-legni-200', images: ['/catalog/official/MF-FRAGR2.09.png'], description: 'Бергамот и зелёный лимон соединяются с цветами апельсина и персика; ваниль, бобы тонка и мускус формируют тёплую базу.', scentFamily: 'warm', mood: 'cozy', room: 'bedroom' },
  'MF-FRAGR2.12': { slug: 'mami-via-delle-spezie-200', images: ['/catalog/official/MF-FRAGR2.12.png'], description: 'Цитрусовая свежесть встречается с тёплыми специями и ягодами мирта; древесина и пачули формируют насыщенный шлейф.', scentFamily: 'spicy', mood: 'cozy', room: 'living' },
  'MF-REFILL.06': { slug: 'mami-nuvola-di-cotone-refill-250', images: ['/catalog/official/MF-REFILL.06.png'], description: 'Рефилл Nuvola di Cotone: бергамот, лимон, чёрная смородина, боярышник, жасмин, роза, ладан и древесные ноты.', scentFamily: 'floral', mood: 'calm', room: 'bedroom' },
  'MF-REFILL.08': { slug: 'mami-coccole-di-talco-refill-250', images: ['/catalog/official/MF-REFILL.08.png'], description: 'Пудровая композиция с лимоном и нероли, розой и цветами апельсина, завершающаяся бобами тонка, ванилью и амброй.', scentFamily: 'warm', mood: 'calm', room: 'bedroom' },
  'MF-REFILL.12': { slug: 'mami-via-delle-spezie-refill-250', images: ['/catalog/official/MF-REFILL.12.png'], description: 'Рефилл Via delle Spezie: цитрусы, тёплые специи и мирт на древесно-пачулиевой базе.', scentFamily: 'spicy', mood: 'cozy', room: 'living' },
  'GI-FRAGR2.02': { slug: 'mami-fior-di-loto-200', images: ['/catalog/official/GI-FRAGR2.02.png'], scentFamily: 'floral', mood: 'calm', room: 'bedroom' },
  'GI-FRAGR2.04': { slug: 'mami-rose-in-fiore-200', images: ['/catalog/official/GI-FRAGR2.04.png'], scentFamily: 'floral', mood: 'calm', room: 'living' },
  'N020445': { slug: 'vinove-rome-evolution-excellence', images: ['/catalog/official/N020445.jpg'], description: 'Rome: слива, корица и тмин; шафран, кедр и пачули; в базе — табак, сандал, ваниль и кожа.', scentFamily: 'woody', mood: 'focused' },
  'N020438': { slug: 'vinove-indianapolis-leather-espresso', images: ['/catalog/official/N020438.jpg'], description: 'Indianapolis: бергамот и кардамон, ирис и лаванда, затем кедр, амбра и мускус.', scentFamily: 'woody', mood: 'focused' },
  'N020434': { slug: 'vinove-monza-leather-ivory', images: ['/catalog/official/N020434.jpg'], description: 'Monza: нероли, бергамот, ананас и персик; фиалка, жасмин и роза; шоколад, карамель и пачули.', scentFamily: 'floral', mood: 'cozy' },
  'N020325': { slug: 'vinove-london-jewelry', images: ['/catalog/official/N020325.jpg'], description: 'London Riverwood: ананас, тонка, какао, кофе и апельсин; цветы, орехи и специи; гваяковое дерево, мёд и ваниль.', scentFamily: 'woody', mood: 'cozy' },
  'N020316': { slug: 'vinove-silverstone-refill', images: ['/catalog/official/N020316.jpg'], description: 'Silverstone: лимон, травы и лаванда; древесные ноты и цветок апельсина; мускус, пудровые ноты и пачули.', scentFamily: 'fresh', mood: 'focused' },
  'N020408': { slug: 'vinove-maranello-refill', images: ['/catalog/official/N020408.jpg'], description: 'Maranello: перец, мандарин и груша; цветок апельсина и жасмин; кофе и ваниль.', scentFamily: 'warm', mood: 'cozy' },
  'N020566': { slug: 'vinove-miami-refill', images: ['/catalog/official/N020566.jpg'], description: 'Miami: лимон, мандарин и красный перец; жасмин, ландыш, лилия и элеми; сандал, кедр, ветивер, амбра и мускус.', scentFamily: 'fresh', mood: 'airy' },
  '0b044a39-8588-11ed-b530-7c8bca00854e': { slug: 'vinove-rome-leather-espresso', images: ['/catalog/official/0b044a39-8588-11ed-b530-7c8bca00854e.jpg'], description: 'Rome: слива, корица и тмин; шафран, кедр и пачули; в базе — табак, сандал, ваниль и кожа.', scentFamily: 'woody', mood: 'focused' },
  'N020334': { slug: 'vinove-paris-refill', images: ['/catalog/official/N020334.jpg'], description: 'Paris: мандарин, персик и шафран; жасмин, гардения и роза; кожа, пачули, ваниль и уд.', scentFamily: 'woody', mood: 'cozy' },
  'N020273': { slug: 'vinove-warsaw-original', description: 'Warsaw: ананас, имбирь и шафран; роза, цитрусы и замша; пачули и сандал.', scentFamily: 'spicy', mood: 'focused' },
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
