import type { CatalogProduct } from './contracts'
import { isPubliclyPurchasable } from './presentation'
import { verifiedNotesFor } from './verifiedNotes'

/** Server-derived display text only; never send evidence records to the card. */
export function tileNoteSummary(product: CatalogProduct, demo = false, debug = false): string | null {
  if (demo || debug || !isPubliclyPurchasable(product)) return null
  const notes = verifiedNotesFor(product)?.displayNotes
  if (!notes?.length || notes.some(note => !note.trim())) return null
  return notes.slice(0, 3).join(' · ')
}
