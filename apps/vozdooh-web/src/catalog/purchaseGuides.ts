import type { CatalogProduct } from './contracts'
import { isPubliclyPurchasable } from './presentation'

export type PurchaseGuide = {
  title: string
  description: string
  intro: string
  questions: readonly { question: string; answer: string }[]
  helpHref: string
  helpLabel: string
}

type Entry = PurchaseGuide & {
  name: string
  brand: string
  category: string
  volume: string | null
  slug: string
  alternatives?: readonly string[]
}

// Public product identities + reviewed editorial facts. No price, stock, coverage,
// runtime, package contents or apparatus compatibility is supplied by this map.
// Evidence and uncertainty: docs/organic-purchase-guides-20261022.md.
function cleaningEntry(volume: '110 мл' | '150 мл', slug: string, otherSku: string): Entry {
  return {
    name: `Жидкость для промывки картридж AG ${volume.replace(' ', '')} пласт.`,
    brand: 'AROMAgroup', category: 'Ароматизация помещений', volume, slug,
    title: `Промывочная жидкость AROMAgroup ${volume} — купить | VOZDOOH`,
    description: `Промывочная жидкость AROMAgroup ${volume} для обслуживания аппарата. Сверьте модель и формат картриджа. Онлайн-заказ в VOZDOOH, доставка в доступные пункты Ozon.`,
    intro: `Картридж с сервисной жидкостью AROMAgroup для промывки системы ароматизации, ${volume}.`,
    questions: [
      { question: 'Для чего нужна промывочная жидкость?', answer: 'Для обслуживания системы ароматизации. Режим и порядок промывки выбирайте по инструкции именно вашего аппарата.' },
      { question: `Подойдёт ли картридж ${volume} моему аппарату?`, answer: 'Проверьте модель аппарата и формат подключения картриджа. Указанный объём сам по себе не подтверждает совместимость.' },
      { question: 'Как выбрать между 110 и 150 мл?', answer: 'В каталоге представлены два объёма жидкости. Выбирайте исполнение, предусмотренное для вашей модели аппарата; одинаковая марка не означает взаимозаменяемость.' },
    ],
    alternatives: [otherSku], helpHref: '/contacts', helpLabel: 'Уточнить выбор картриджа',
  }
}

const entries: Readonly<Record<string, Entry>> = {
  '9a227639-b1a0-11ed-a1a3-7c8bca00854e': cleaningEntry('110 мл', 'aromagroup-cleaning-fluid-110', '4356'),
  '4356': cleaningEntry('150 мл', 'aromagroup-cleaning-fluid-150', '9a227639-b1a0-11ed-a1a3-7c8bca00854e'),
  '76544': {
    name: 'Магма картридж AG 100мл пласт.', brand: 'AROMAgroup', category: 'Ароматизация помещений', volume: '100 мл', slug: 'aromagroup-magma-100',
    title: 'Картридж AROMAgroup Магма 100 мл — купить | VOZDOOH',
    description: 'Картридж AROMAgroup «Магма», 100 мл. Сменный аромат для профессиональной ароматизации; совместимость проверяют по модели аппарата. Заказать в VOZDOOH.',
    intro: 'Сменный ароматический картридж AROMAgroup «Магма», 100 мл.',
    questions: [
      { question: 'Что представлено в этой карточке?', answer: 'Ароматический картридж «Магма» объёмом 100 мл для профессиональной системы ароматизации.' },
      { question: 'Как проверить совместимость с аппаратом?', answer: 'Сопоставьте точную модель аппарата и формат подключения картриджа с инструкцией или маркировкой. Объём 100 мл не заменяет проверку совместимости.' },
      { question: 'Как обслуживать аппарат при замене аромата?', answer: 'Порядок обслуживания и режим промывки зависят от модели аппарата. Следуйте её инструкции; для промывки выбирают сервисную жидкость.' },
    ],
    helpHref: '/contacts', helpLabel: 'Уточнить совместимость картриджа',
  },
  '3444567': {
    name: 'Джованни картридж AG 150мл пласт.', brand: 'AROMAgroup', category: 'Ароматизация помещений', volume: '150 мл', slug: 'aromagroup-dzhovanni-150',
    title: 'Картридж AROMAgroup Джованни 150 мл — купить | VOZDOOH',
    description: 'Картридж AROMAgroup «Джованни», 150 мл: озон, цитрусы, цветочные и древесные ноты. Совместимость проверяют по модели аппарата. Заказать в VOZDOOH.',
    intro: 'Сменный ароматический картридж AROMAgroup «Джованни», 150 мл.',
    questions: [
      { question: 'Как пахнет «Джованни»?', answer: 'В описании композиции указаны озон и цитрусы, цветочные и древесные ноты.' },
      { question: 'Подойдёт ли картридж моему аппарату?', answer: 'Проверьте точную модель аппарата и формат подключения по инструкции или маркировке. Одинаковый объём картриджей не подтверждает совместимость.' },
      { question: 'Где посмотреть артикул и объём?', answer: 'Объём этой позиции — 150 мл. Артикул и исходное наименование указаны в разделе «Подробности и характеристики» на этой странице.' },
    ],
    helpHref: '/contacts', helpLabel: 'Уточнить совместимость картриджа',
  },
  'fa750378-783b-11ed-b530-7c8bca00854e': {
    name: 'Аппарат для ароматизации помещений AROMAgroup Dispenser Liquid bt V3.1 (белый)', brand: 'AROMAgroup', category: 'Ароматизация помещений', volume: null, slug: 'aromagroup-dispenser-liquid-white',
    title: 'Аппарат AROMAgroup Dispenser Liquid bt V3.1, белый — купить | VOZDOOH',
    description: 'Аппарат AROMAgroup Dispenser Liquid bt V3.1, белый. Сравните модель и комплектацию перед покупкой. Заказать в VOZDOOH с доставкой в доступные пункты Ozon.',
    intro: 'Аппарат для ароматизации помещений, версия bt V3.1, белый корпус.',
    questions: [
      { question: 'Какую модель я заказываю?', answer: 'AROMAgroup Dispenser Liquid bt V3.1 в белом исполнении. Точная версия указана в исходном наименовании товара.' },
      { question: 'Как подобрать картридж к аппарату?', answer: 'Сверьте модель и версию аппарата с маркировкой картриджа или инструкцией производителя. Совпадение бренда и объёма не заменяет эту проверку.' },
      { question: 'Что уточнить перед покупкой?', answer: 'Состав комплекта, тип питания и наличие картриджа. Эти сведения нужно подтвердить для версии bt V3.1; характеристики другой версии могут отличаться.' },
    ],
    helpHref: '/contacts', helpLabel: 'Уточнить комплектацию аппарата',
  },
  'MF-REFILL.08': {
    name: 'MAMI MILANO Рефилл для диффузора COCCOLE DI TALCO / Пудровые объятия. Коллекция PALAZZO, 250 мл', brand: 'MAMI MILANO', category: 'Рефилы', volume: '250 мл', slug: 'mami-coccole-di-talco-refill-250',
    title: 'Рефил MAMI MILANO Coccole di Talco 250 мл — купить | VOZDOOH',
    description: 'Рефил MAMI MILANO Coccole di Talco 250 мл для диффузора с палочками. Пудровый аромат с лимоном, нероли и ванилью. Заказать в VOZDOOH.',
    intro: 'Сменный аромат Coccole di Talco для пополнения диффузора с палочками.',
    questions: [
      { question: 'Что такое рефил Coccole di Talco?', answer: 'Это сменная ароматическая жидкость для пополнения диффузора с палочками. Объём этой позиции — 250 мл.' },
      { question: 'Как пахнет Coccole di Talco?', answer: 'Пудровая композиция: лимон и нероли, роза и цветы апельсина; в базе — бобы тонка, ваниль и амбра.' },
      { question: 'Как использовать рефил?', answer: 'Откройте флакон и аккуратно перелейте аромат в подходящий флакон диффузора, не проливая жидкость. Способ применения сверяйте с инструкцией к диффузору.' },
    ],
    helpHref: '/guides/refil-dlya-diffuzora-kak-ispolzovat', helpLabel: 'Подробнее об использовании рефила',
  },
}

/** Call after withValidImages. Exact identity guards fail closed after a new import. */
export function reviewedPurchaseGuide(product: CatalogProduct): PurchaseGuide | null {
  const entry = entries[product.trade.sku]
  if (!entry || !isPubliclyPurchasable(product) || !Number.isFinite(product.trade.stock) || product.trade.name !== entry.name ||
      product.trade.brand !== entry.brand || product.trade.category !== entry.category ||
      product.trade.volume !== entry.volume || product.editorial.slug !== entry.slug) return null
  return entry
}

/** These are volume alternatives, never a compatibility recommendation. */
export function purchaseGuideAlternatives(products: readonly CatalogProduct[], current: CatalogProduct): CatalogProduct[] {
  if (!reviewedPurchaseGuide(current)) return []
  const allowed = entries[current.trade.sku].alternatives ?? []
  return products.filter(product => allowed.includes(product.trade.sku) && reviewedPurchaseGuide(product) !== null)
}
