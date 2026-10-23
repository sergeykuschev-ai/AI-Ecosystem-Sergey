import type { Metadata } from 'next'

export function searchIndexingEnabled(value = process.env.SEARCH_INDEXING_ENABLED): boolean {
  return value === 'true'
}

export function publicRobots(value = process.env.SEARCH_INDEXING_ENABLED): Metadata['robots'] {
  return searchIndexingEnabled(value)
    ? { index: true, follow: true }
    : { index: false, follow: false }
}
