import type { CatalogProduct } from './contracts'
import { storefrontProducts } from './presentation'

export type Landing = { slug: string; name: string; description: string; guidance: string }

/** Inventory-led copy, not brand history. Sources and scope are recorded in
 * research/catalog-cleanup-evidence-2026-09.md. Only stocked, pictured products
 * determine which landing pages and cross-links are available.
 */
export const brandLandings: readonly Landing[] = [
  { slug: 'culti-milano', name: 'CULTI MILANO', description: 'Aramara, Tessuto, Aqqua и другие ароматы CULTI MILANO в коллекции VOZDOOH.', guidance: 'Сравните аромат, объём и коллекцию флакона. Aramara Decor Classic и Stile Classic представлены отдельно: один аромат, разные варианты оформления.' },
  { slug: 'teatro-fragranze-uniche', name: 'TEATRO Fragranze Uniche', description: 'Интерьерные ароматы TEATRO: Dolce Vaniglia, Bianco Divino, Rose Oud и другие композиции.', guidance: 'Выберите формат в подборке ниже. Диффузоры, рефилы и палочки представлены отдельно; объём и комплектацию можно посмотреть в карточке.' },
  { slug: 'lothantique', name: 'Lothantique', description: 'Ароматы Lothantique для дома: Les Secrets d’Antoine, Sandalwood, Cotton Flower и другие композиции.', guidance: 'Сравните описания ароматов и формат. Свеча и диффузор одного бренда — самостоятельные позиции коллекции.' },
  { slug: 'christian-tortu', name: 'Christian Tortu', description: 'Tuberose, Tomato Leaf, Jardin Citrus и Vert Frais в подборке Christian Tortu.', guidance: 'В коллекции есть диффузоры и аромапопурри. Сменный аромат и керамическая ваза представлены отдельными позициями: состав уточняется в карточке.' },
  { slug: 'vellutier', name: 'Vellutier', description: 'Ароматические свечи Vellutier: Midnight Toast, Oudwood Journey и другие композиции.', guidance: 'Сравните аромат и массу свечи. Разные размеры Midnight Toast доступны отдельными карточками.' },
  { slug: 'danhera', name: 'DANHERA', description: 'DANHERA NIRO — диффузор 250 мл с пряно-древесной композицией.', guidance: 'В описании NIRO — кипарис, элеми, личи, перуанский бальзам, сандал, уд и пачули. Откройте карточку, чтобы рассмотреть флакон и характеристики.' },
  { slug: 'mami-milano', name: 'MAMI MILANO', description: 'Диффузоры и рефилы MAMI MILANO, включая ароматы коллекции Palazzo.', guidance: 'Сравните названия ароматов и объёмы. Рефил — отдельный формат для пополнения диффузора; он не заменяет комплект с флаконом.' },
  { slug: 'vinove', name: 'VINOVE', description: 'Ароматы VINOVE для автомобиля: Rome, Indianapolis, Monza, London и сменные блоки.', guidance: 'Название города обозначает вариант аромата. Обратите внимание на коллекцию корпуса и формат: ароматизаторы и сменные блоки показаны отдельно.' },
  { slug: 'millefiori-milano', name: 'Millefiori Milano', description: 'Mimosa Flower — водорастворимый аромат Millefiori Milano, 15 мл.', guidance: 'Этот формат предназначен для ультразвуковых диффузоров Hydro. Ноты композиции и описание применения указаны в карточке.' },
  { slug: 'castelbel', name: 'Castelbel', description: 'Ароматические саше Castelbel в коллекции VOZDOOH.', guidance: 'Небольшой формат для знакомства с коллекцией. Выберите вариант и откройте карточку с его описанием.' },
  { slug: 'ladenac-milano', name: 'Ladenac Milano', description: 'Свечи, диффузоры и наборы Ladenac Milano в коллекции VOZDOOH.', guidance: 'Названия коллекций и вариантов сохранены в карточках. Сравните формат, объём и указанную комплектацию каждого набора.' },
  { slug: 'aromagroup', name: 'AROMAgroup', description: 'Картриджи и аппараты AROMAgroup для ароматизации помещений.', guidance: 'Выбирайте картридж по модели аппарата. Одинаковый объём не подтверждает совместимость; описание аромата не заменяет проверку подключения.' },
]

export const categoryLandings: readonly Landing[] = [
  { slug: 'diffusers', name: 'Диффузоры', description: 'Диффузоры для дома: ароматы, коллекции флаконов и объёмы из ассортимента VOZDOOH.', guidance: 'Сравните композицию и объём. Рефилы и сменные палочки вынесены в отдельные категории; комплектацию каждого диффузора смотрите в карточке.' },
  { slug: 'candles', name: 'Свечи', description: 'Ароматические свечи для дома в разных композициях и размерах.', guidance: 'Выберите аромат и массу свечи. Характеристики относятся к конкретной карточке: состав воска и время горения не переносятся между размерами.' },
  { slug: 'car', name: 'Для автомобиля', description: 'Автомобильные ароматизаторы, саше и сменные блоки в коллекции VOZDOOH.', guidance: 'Сравните аромат и формат. Сменный блок и готовый ароматизатор — разные позиции; совместимость следует проверять для выбранной модели.' },
  { slug: 'sprays', name: 'Спреи для дома', description: 'Интерьерные спреи: ароматы для пространства в формате распылителя.', guidance: 'Выберите композицию и объём. Назначение для тканей не предполагается автоматически: следуйте маркировке конкретного средства.' },
  { slug: 'refills', name: 'Рефилы', description: 'Сменные ароматы и рефилы для пополнения интерьерной коллекции.', guidance: 'Сверьте бренд, аромат и назначение. Рефил для диффузора и сменный аромат для аромапопурри различаются по применению.' },
  { slug: 'accessories', name: 'Аксессуары', description: 'Палочки и аксессуары для интерьерных ароматов.', guidance: 'Проверьте назначение и размер для вашего флакона. Обозначение объёма диффузора в названии палочек не означает наличие ароматической жидкости в комплекте.' },
  { slug: 'water-soluble', name: 'Водорастворимые ароматы', description: 'Водорастворимые ароматы для совместимых ультразвуковых диффузоров.', guidance: 'Это концентрат, а не готовый диффузор с палочками. Используйте его по инструкции производителя выбранного аппарата и аромата.' },
  { slug: 'home-fragrance', name: 'Ароматы для пространства', description: 'Саше и аромапопурри для знакомства с интерьерной парфюмерией.', guidance: 'Обратите внимание на формат в названии и описании. Для саше объём в миллилитрах может не применяться.' },
  { slug: 'gifts', name: 'Подарочные наборы', description: 'Наборы интерьерных ароматов из коллекции VOZDOOH.', guidance: 'Сравните оформление и состав, указанный для конкретного набора. Одинаковое название аромата не означает одинаковую комплектацию.' },
  { slug: 'professional', name: 'Ароматизация помещений', description: 'Аппараты и ароматические картриджи для систем ароматизации помещений.', guidance: 'Подбор зависит от модели аппарата и формата картриджа. До выбора расходных материалов необходимо уточнить совместимость.' },
]

export function landingProducts(products: readonly CatalogProduct[], kind: 'brand' | 'category', name: string): CatalogProduct[] {
  return storefrontProducts(products.filter((product) => (product.trade.stock ?? 0) > 0 && product.trade[kind] === name))
}

export function availableLandings(products: readonly CatalogProduct[], kind: 'brand' | 'category') {
  return (kind === 'brand' ? brandLandings : categoryLandings)
    .map((landing) => ({ ...landing, products: landingProducts(products, kind, landing.name) }))
    .filter((landing) => landing.products.length > 0)
}

export function landingPath(kind: 'brand' | 'category', slug: string): string {
  return `/${kind === 'brand' ? 'brands' : 'categories'}/${slug}`
}
