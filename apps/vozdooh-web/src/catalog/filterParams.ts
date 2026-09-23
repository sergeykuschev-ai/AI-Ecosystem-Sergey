import { categoryLabels, familyLabels, moodLabels, roomLabels } from './demo'
import type { DemoFilters } from './filters'

/** Parse and validate raw URL search params into known demo filter keys. Unknown values are ignored. */

export type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return typeof value === 'string' && value !== '' ? value : null
}

function pick<K extends string>(labels: Record<K, string>, value: string | null): K | null {
  if (!value) return null
  return Object.prototype.hasOwnProperty.call(labels, value) ? (value as K) : null
}

export function parseDemoFilters(params: RawSearchParams): DemoFilters {
  return {
    category: pick(categoryLabels, first(params.category)),
    family: pick(familyLabels, first(params.family)),
    mood: pick(moodLabels, first(params.mood)),
    room: pick(roomLabels, first(params.room)),
  }
}

export type FilterGroup = 'category' | 'family' | 'mood' | 'room'

/** Build a catalog href toggling one filter while preserving the others. */
export function catalogHref(current: DemoFilters, group: FilterGroup, value: string | null): string {
  const next: Record<string, string> = {}
  const entries: [FilterGroup, string | null][] = [
    ['category', current.category],
    ['family', current.family],
    ['mood', current.mood],
    ['room', current.room],
  ]
  for (const [key, val] of entries) {
    if (!val) continue
    next[key] = key === group ? (value ?? '') : val
  }
  if (group !== null && value) next[group] = value
  const query = Object.entries(next)
    .filter(([, val]) => val !== '')
    .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
    .join('&')
  return query ? `/catalog?${query}` : '/catalog'
}
