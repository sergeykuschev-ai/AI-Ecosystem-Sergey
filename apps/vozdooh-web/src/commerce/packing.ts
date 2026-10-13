import type { ParcelDimensions } from './ozonDeliveryBusiness'

/** Physical cartons must be measured, not inferred from a product's dimensions. */
export type VerifiedCarton = {
  id: string
  status: 'VERIFIED'
  innerLengthMm: number
  innerWidthMm: number
  innerHeightMm: number
  outerLengthMm: number
  outerWidthMm: number
  outerHeightMm: number
  tareWeightG: number
  maxGrossWeightG: number
}
export class PackingError extends Error { constructor(public code: string) { super(code) } }

type Unit = { sku: string; dimensions: ParcelDimensions }
function rotations(d: ParcelDimensions): [number, number, number][] {
  const a = [d.lengthMm, d.widthMm, d.heightMm]
  const values = new Map<string, [number, number, number]>()
  for (const x of [0, 1, 2]) for (const y of [0, 1, 2]) if (x !== y) {
    const z = 3 - x - y
    const r: [number, number, number] = [a[x], a[y], a[z]]
    values.set(r.join(','), r)
  }
  return [...values.values()]
}
function validCarton(box: VerifiedCarton) {
  const nums = [box.innerLengthMm, box.innerWidthMm, box.innerHeightMm, box.outerLengthMm, box.outerWidthMm, box.outerHeightMm, box.tareWeightG, box.maxGrossWeightG]
  return box.status === 'VERIFIED' && /^[a-z0-9_-]{1,64}$/i.test(box.id) && nums.every(Number.isSafeInteger) &&
    Math.min(...nums.slice(0, 6)) > 0 && box.tareWeightG > 0 && box.maxGrossWeightG > box.tareWeightG &&
    box.innerLengthMm <= box.outerLengthMm && box.innerWidthMm <= box.outerWidthMm && box.innerHeightMm <= box.outerHeightMm
}
/** Safe simple packing: every item sits in its own full-width segment of the carton.
 * Deliberately rejects arrangements it cannot prove will fit. No fragile-product
 * stacking assumptions or fictitious packaging allowances are made. */
export function packVerifiedUnits(units: Unit[], cartons: VerifiedCarton[]): { cartonId: string; parcel: ParcelDimensions } {
  if (!units.length || units.length > 100) throw new PackingError('PACKING_UNIT_COUNT_UNSUPPORTED')
  if (!cartons.length) throw new PackingError('PACKING_VERIFIED_CARTON_MISSING')
  if (cartons.some((c) => !validCarton(c))) throw new PackingError('PACKING_CARTON_INVALID')
  const weight = units.reduce((sum, unit) => sum + unit.dimensions.weightG, 0)
  if (!Number.isSafeInteger(weight) || units.some((unit) => !Object.values(unit.dimensions).every((n) => Number.isSafeInteger(n) && n > 0))) {
    throw new PackingError('PACKING_PRODUCT_DIMENSIONS_INVALID')
  }
  const choices = [] as Array<{ cartonId: string; parcel: ParcelDimensions; volume: number }>
  for (const box of cartons) {
    const gross = weight + box.tareWeightG
    if (!Number.isSafeInteger(gross) || gross > box.maxGrossWeightG) continue
    // Dynamic programming across allowed 90-degree rotations. For each unit,
    // find a rotation that fits the full inner width and height and minimizes length.
    let usedLength = 0
    for (const unit of units) {
      const lengths = rotations(unit.dimensions).filter(([l, w, h]) => w <= box.innerWidthMm && h <= box.innerHeightMm).map(([l]) => l)
      if (!lengths.length) { usedLength = Infinity; break }
      usedLength += Math.min(...lengths)
    }
    if (usedLength > box.innerLengthMm) continue
    choices.push({ cartonId: box.id, parcel: { weightG: gross, lengthMm: box.outerLengthMm, widthMm: box.outerWidthMm, heightMm: box.outerHeightMm }, volume: box.outerLengthMm * box.outerWidthMm * box.outerHeightMm })
  }
  if (!choices.length) throw new PackingError('PACKING_NO_VERIFIED_CARTON_FITS')
  choices.sort((a, b) => a.volume - b.volume || a.parcel.weightG - b.parcel.weightG || a.cartonId.localeCompare(b.cartonId))
  return { cartonId: choices[0].cartonId, parcel: choices[0].parcel }
}
