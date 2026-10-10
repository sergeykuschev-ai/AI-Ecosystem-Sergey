import type { CatalogProduct } from './contracts'

export type FragranceFacts = {
  name: string
  family: string
  facet: string | null
  notes: string[]
  summary: string
  rooms: string[]
  seasons: string[]
  created: string | null
  source: string
}

const FACTS: Record<string, FragranceFacts> = {
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
  if (brand === 'CULTI MILANO') {
    if (/\bAramara\b/i.test(name)) return FACTS.aramara
    if (/\bTessuto\b/i.test(name)) return FACTS.tessuto
    if (/\bAqqua\b/i.test(name)) return FACTS.aqqua
  }
  if (brand === 'TEATRO Fragranze Uniche' && /DOLCE\s+VANIGLIA|Dolce\s+Vaniglia/i.test(name)) return FACTS['dolce-vaniglia']
  return null
}
