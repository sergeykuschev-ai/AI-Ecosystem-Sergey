export type DemoCategory = 'diffusers' | 'candles' | 'sprays' | 'refills' | 'car' | 'gifts'
export type DemoFamily = 'woody' | 'fresh' | 'citrus' | 'floral' | 'spicy' | 'warm'
export type DemoMood = 'calm' | 'airy' | 'cozy' | 'focused'
export type DemoRoom = 'living' | 'bedroom' | 'bathroom' | 'study' | 'hallway'

export const categoryLabels: Record<DemoCategory, string> = {
  diffusers: 'Диффузоры',
  candles: 'Свечи',
  sprays: 'Спреи',
  refills: 'Рефилы',
  car: 'Для автомобиля',
  gifts: 'Подарки',
}

export const familyLabels: Record<DemoFamily, string> = {
  woody: 'Древесные',
  fresh: 'Свежие',
  citrus: 'Цитрусовые',
  floral: 'Цветочные',
  spicy: 'Пряные',
  warm: 'Тёплые',
}

export const moodLabels: Record<DemoMood, string> = {
  calm: 'Спокойствие',
  airy: 'Лёгкость',
  cozy: 'Уют',
  focused: 'Собранность',
}

export const roomLabels: Record<DemoRoom, string> = {
  living: 'Гостиная',
  bedroom: 'Спальня',
  bathroom: 'Ванная',
  study: 'Кабинет',
  hallway: 'Прихожая',
}

export function labelFor(labels: Record<string, string>, value: string | null): string {
  return value === null ? 'Не указано' : Object.hasOwn(labels, value) ? labels[value] : value
}
