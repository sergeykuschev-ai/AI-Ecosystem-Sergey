import type { CatalogProduct } from './contracts'

export type FragranceFacts = {
  name: string
  family: string | null
  facet: string | null
  notes: string[]
  summary: string
  rooms: string[]
  seasons: string[]
  created: string | null
  source: string
}

const FACTS: Record<string, FragranceFacts> = {
  niro: {
    name: 'NIRO', family: 'древесное', facet: 'пряное',
    notes: ['кипарис', 'элеми', 'озон', 'личи', 'перуанский бальзам', 'сандал', 'уд', 'пачули'],
    summary: 'Пряно-древесная композиция с кипарисом и элеми, личи и перуанским бальзамом на базе сандала, уда и пачули.',
    rooms: [], seasons: [], created: null,
    source: 'карточки Bosco и ЦУМ для NIRO 250 мл',
  },
  mareminerale: {
    name: 'Mareminerale',
    family: 'ароматическое',
    facet: 'морское',
    notes: ['морской аккорд', 'сок растений', 'минеральный мускус'],
    summary: 'Свежая морская композиция с морским аккордом, зелёным соком растений и минеральным мускусом.',
    rooms: ['гостиная', 'частные пространства', 'SPA'],
    seasons: ['весна', 'лето', 'осень', 'зима'],
    created: '1997',
    source: 'официальное описание CULTI MILANO',
  },
  aramara: {
    name: 'Aramara',
    family: 'цитрусовое',
    facet: 'древесное',
    notes: ['горький апельсин', 'бергамот', 'сандал'],
    summary: 'Цитрусовая композиция с горьким апельсином и бергамотом, которую сандал делает теплее и глубже.',
    rooms: ['гостиная', 'кухня', 'кабинет'],
    seasons: ['весна', 'лето'],
    created: '2001',
    source: 'официальное описание CULTI MILANO',
  },
  tessuto: {
    name: 'Tessuto',
    family: 'цветочное',
    facet: 'мускусное',
    notes: ['листья кассиса', 'цветы хлопка', 'жасмин', 'белый мускус'],
    summary: 'Чистая мягкая композиция с листьями кассиса, цветами хлопка, жасмином и белым мускусом — с ощущением свежего текстиля.',
    rooms: ['гостиная', 'спальня'],
    seasons: ['весна', 'лето', 'осень', 'зима'],
    created: '2001',
    source: 'официальное описание CULTI MILANO',
  },
  aqqua: {
    name: 'Aqqua',
    family: 'древесное',
    facet: 'цитрусовое',
    notes: ['кориандр', 'бергамот', 'мимоза', 'шалфей', 'сандал'],
    summary: 'Свежая древесно-цитрусовая композиция с бергамотом, ароматическими травами и сандалом.',
    rooms: ['гостиная', 'ванная', 'кабинет'],
    seasons: ['весна', 'лето', 'осень', 'зима'],
    created: '1990',
    source: 'официальное описание CULTI MILANO',
  },

  'rose-oud': {
    name: 'Rose Oud',
    family: null,
    facet: null,
    notes: ['дамасская роза', 'розовый перец', 'мускатный орех', 'гвоздика', 'мирра', 'опопонакс', 'шафран', 'жасмин', 'герань', 'уд', 'пачули', 'сандал', 'кедр', 'мускус'],
    summary: 'Насыщенная композиция дамасской розы и уда с розовым перцем, специями, смолами, пачули, сандалом, кедром и мускусом.',
    rooms: ['общие зоны', 'частные пространства'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
  'bianco-divino': {
    name: 'Bianco Divino',
    family: null,
    facet: null,
    notes: ['виноград Шампань', 'яблоко', 'лимон', 'сладкий апельсин', 'болгарская роза', 'глициния', 'гвоздика', 'фиалка', 'белый мускус', 'бамбук', 'сандал'],
    summary: 'Искристая композиция с виноградом Шампань, яблоком и цитрусами, цветочным сердцем и мягкой базой белого мускуса, бамбука и сандала.',
    rooms: ['общие зоны', 'зоны отдыха'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
  'foglie-di-fico': {
    name: 'Foglie di Fico',
    family: 'фруктовое',
    facet: 'зелёное',
    notes: ['листья инжира', 'апельсин', 'лимон', 'ландыш', 'кедровое дерево', 'ветивер', 'белый мускус', 'сандал'],
    summary: 'Зелёная композиция листьев инжира с цитрусами, ландышем, кедровым деревом, ветивером, белым мускусом и сандалом.',
    rooms: ['кухня', 'столовая', 'веранда'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
  diamante: {
    name: 'Diamante',
    family: null,
    facet: null,
    notes: ['кристаллы сахара', 'амбровая пудра', 'сафраналь', 'Amber Extreme Accord', 'Ambrinol', 'Galaxolide', 'Karmawood', 'Amberwood', 'Timbertouch', 'сибирская ель', 'кедр'],
    summary: 'Абстрактная пудрово-амбровая композиция с сахарными кристаллами, сафраналем, современными амбровыми аккордами и древесной базой.',
    rooms: ['приёмная', 'гостиная', 'спальня'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
  'incenso-imperiale': {
    name: 'Incenso Imperiale',
    family: 'восточное',
    facet: 'древесно-пряное',
    notes: ['ладан', 'уд', 'ладанник', 'фиалка', 'кедр', 'бамбук', 'ветивер', 'белый мускус', 'бобы тонка'],
    summary: 'Тёплая древесно-пряная композиция с ладаном и удом, кедром, бамбуком, ветивером, белым мускусом и бобами тонка.',
    rooms: ['рабочая зона', 'кабинет', 'зона для медитации'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
  fiore: {
    name: 'Fiore',
    family: 'цветочное',
    facet: null,
    notes: ['гардения', 'нарцисс', 'жасмин', 'франжипани', 'роза', 'кедр', 'пачули', 'белый мускус', 'гелиотроп'],
    summary: 'Букет белых цветов с гарденией, нарциссом и жасмином, сердцем из франжипани и розы и мягкой мускусной базой.',
    rooms: ['общие жилые зоны', 'частные пространства'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
  santal: {
    name: 'Santal',
    family: 'древесное',
    facet: null,
    notes: [],
    summary: 'Мягкий древесный аромат, созданный для Lothantique парфюмерами в Грассе.',
    rooms: [],
    seasons: [],
    created: null,
    source: 'официальное описание Lothantique',
  },
  'les-secrets-antoine': {
    name: 'Les Secrets d’Antoine',
    family: 'древесное',
    facet: 'цитрусовое',
    notes: ['мандарин', 'розовое дерево', 'мускус'],
    summary: 'Древесно-цитрусовая композиция с мандарином, розовым деревом и мускусом.',
    rooms: [],
    seasons: [],
    created: null,
    source: 'официальные материалы Lothantique',
  },
  'oudwood-journey': {
    name: 'Oudwood Journey',
    family: null,
    facet: null,
    notes: ['уд', 'олибанум', 'пачули', 'мускус', 'амбра'],
    summary: 'Восточная композиция с удом, олибанумом, пачули, мускусом и амброй.',
    rooms: [],
    seasons: [],
    created: null,
    source: 'официальный каталог Vellutier',
  },
  'midnight-toast': {
    name: 'Midnight Toast',
    family: null,
    facet: null,
    notes: ['джин-тоник', 'дыня канталупа', 'цветок апельсина', 'тиковое дерево', 'кедр'],
    summary: 'Необычная композиция джин-тоника и дыни канталупы с цветком апельсина, тиковым деревом и кедром.',
    rooms: [],
    seasons: [],
    created: null,
    source: 'официальный каталог Vellutier',
  },
  'dolce-vaniglia': {
    name: 'Dolce Vaniglia',
    family: 'гурманское',
    facet: null,
    notes: ['сахарная пудра', 'карамель', 'тёмный шоколад', 'цветок ванили', 'белый мускус', 'ваниль', 'бобы тонка'],
    summary: 'Тёплая гурманская композиция: сахарная пудра и карамель переходят в шоколад и цветок ванили, а в базе остаются белый мускус, ваниль и бобы тонка.',
    rooms: ['кухня', 'столовая'],
    seasons: [],
    created: null,
    source: 'официальное описание TEATRO Fragranze Uniche',
  },
}

export function fragranceFactsFor(product: CatalogProduct): FragranceFacts | null {
  const brand = product.trade.brand ?? ''
  const name = product.trade.name
  if (product.trade.sku === 'DANHNIR250DEC' && brand === 'DANHERA' && /\bNIRO\b/.test(name)) return FACTS.niro
  if (brand === 'CULTI MILANO') {
    if (/\bAramara\b/i.test(name)) return FACTS.aramara
    if (/\bTessuto\b/i.test(name)) return FACTS.tessuto
    if (/\bAqqua\b/i.test(name)) return FACTS.aqqua
    if (/\bMareminerale\b/i.test(name)) return product.trade.category === 'Для автомобиля'
      ? { ...FACTS.mareminerale, rooms: [], seasons: [], created: null }
      : FACTS.mareminerale
  }
  if (brand === 'Lothantique') {
    if (/LES\s+SECRETS\s+D['’]ANTOINE|Les\s+Secrets\s+d['’]Antoine/i.test(name)) return FACTS['les-secrets-antoine']
    if (/SANDALWOOD|SANTAL/i.test(name)) return FACTS.santal
  }
  if (brand === 'Vellutier') {
    if (/Oudwood Journey|Удовое дерево/i.test(name)) return FACTS['oudwood-journey']
    if (/Midnight Toast|Вечерний тост/i.test(name)) return FACTS['midnight-toast']
  }
  if (brand === 'TEATRO Fragranze Uniche') {
    if (/DOLCE\s+VANIGLIA|Dolce\s+Vaniglia/i.test(name)) return FACTS['dolce-vaniglia']
    if (/ROSE\s+OUD|Rose\s+Oud/i.test(name)) return FACTS['rose-oud']
    if (/BIANCO\s+DIVINO|Bianco\s+Divino/i.test(name)) return FACTS['bianco-divino']
    if (/FOGLIE\s+DI\s+FICO|Foglie\s+di\s+Fico/i.test(name)) return FACTS['foglie-di-fico']
    if (/DIAMANTE/i.test(name)) return FACTS.diamante
    if (/INCENSO\s+IMPERIALE|Incenso\s+Imperiale/i.test(name)) return FACTS['incenso-imperiale']
    if (/\bFIORE\b|\bFiore\b/i.test(name)) return FACTS.fiore
  }
  return null
}
