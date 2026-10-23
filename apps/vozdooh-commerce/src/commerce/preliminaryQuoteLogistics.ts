import fs from 'node:fs'
import path from 'node:path'
import type { OrderRequest } from './orderRequests'
import type { ParcelDimensions } from './ozonDeliveryBusiness'
import { parcelForOrder, LogisticsDataError } from './logisticsDataset'

type PreliminaryProduct = {
  sku: string
  barcode: string
  status: 'PROVISIONAL'
  productWeightG: number
  productDimensionsMm: [number, number, number]
  sourceScope: string
  sourceUrls: string[]
}
type MarketCarton = {
  id: string
  status: 'ESTIMATED'
  innerLengthMm: number
  innerWidthMm: number
  innerHeightMm: number
  outerLengthMm: number
  outerWidthMm: number
  outerHeightMm: number
  estimatedTareWeightG: number
}

// The reserve is only for the *quote*. The packed parcel must be weighed and
// measured before carrier shipment is created. No estimated data is ever added
// to the VERIFIED logistics dataset used by the autonomous commerce worker.
const PROTECTION_RESERVE_G = 150
const MIN_CLEARANCE_PER_AXIS_MM = 20

export function loadPreliminaryQuoteData(
  file = path.resolve('research/data/owner-authorized-preliminary-logistics.json'),
  cartonsFile = path.resolve('research/data/estimated-cartons-market.json'),
): { products: PreliminaryProduct[]; cartons: MarketCarton[] } {
  const productsData = JSON.parse(fs.readFileSync(file, 'utf8')) as {schemaVersion?:unknown;status?:unknown;products?:unknown}
  const cartonsData = JSON.parse(fs.readFileSync(cartonsFile, 'utf8')) as {schemaVersion?:unknown;status?:unknown;cartons?:unknown}
  if (productsData.schemaVersion !== 1 || productsData.status !== 'OWNER_AUTHORIZED_FOR_INDICATIVE_QUOTE_ONLY' || !Array.isArray(productsData.products) ||
      cartonsData.schemaVersion !== 1 || cartonsData.status !== 'REFERENCE_ONLY_NOT_VERIFIED' || !Array.isArray(cartonsData.cartons)) {
    throw new LogisticsDataError('PRELIMINARY_QUOTE_DATA_INVALID')
  }
  const products = productsData.products as PreliminaryProduct[]
  const cartons = cartonsData.cartons as MarketCarton[]
  const ids = new Set<string>()
  for (const p of products) {
    if (p.status !== 'PROVISIONAL' || !p.sku || ids.has(p.sku) || !/^[0-9a-z-]{1,64}$/i.test(p.sku) ||
        typeof p.barcode !== 'string' || p.barcode.length < 8 ||
        !Number.isSafeInteger(p.productWeightG) || p.productWeightG <= 0 ||
        !Array.isArray(p.productDimensionsMm) || p.productDimensionsMm.length !== 3 ||
        !p.productDimensionsMm.every((n) => Number.isSafeInteger(n) && n > 0) ||
        !p.sourceScope || !Array.isArray(p.sourceUrls) || !p.sourceUrls.length) {
      throw new LogisticsDataError('PRELIMINARY_QUOTE_PRODUCT_INVALID')
    }
    ids.add(p.sku)
  }
  if (!cartons.length || cartons.some((c) => c.status !== 'ESTIMATED' || !/^[0-9a-z-]{1,64}$/i.test(c.id) ||
    ![c.innerLengthMm, c.innerWidthMm, c.innerHeightMm, c.outerLengthMm, c.outerWidthMm, c.outerHeightMm, c.estimatedTareWeightG]
      .every((n) => Number.isSafeInteger(n) && n > 0) ||
    c.innerLengthMm > c.outerLengthMm || c.innerWidthMm > c.outerWidthMm || c.innerHeightMm > c.outerHeightMm)) {
    throw new LogisticsDataError('PRELIMINARY_QUOTE_CARTON_INVALID')
  }
  return { products, cartons }
}

export type QuoteParcelResult = { parcel: ParcelDimensions; provisional: boolean }

/** A read-only preliminary quote uses source numbers unchanged, but accounts
 * separately for the empty reference shipping box and protective material.
 * This method must NEVER be used by the delivery creation worker. */
export function parcelForPreliminaryQuote(
  order: OrderRequest,
  data?: {products: PreliminaryProduct[];cartons: MarketCarton[]},
): QuoteParcelResult {
  const units = order.lines.reduce((sum, item) => sum + item.quantity, 0)
  if (units !== 1 || order.lines.length !== 1) return { parcel: parcelForOrder(order), provisional: false }
  const row = order.lines[0]
  const verified = parcelForOrder
  // Existing verified SKU has priority and must keep its established behavior.
  // The candidate path below only activates when the SKU is absent from verified data.
  let fallbackError: unknown
  try { return { parcel: verified(order), provisional: false } }
  catch (e) {
    if (!(e instanceof LogisticsDataError) || e.code !== 'LOGISTICS_SKU_NOT_VERIFIED') throw e
    fallbackError = e
  }
  const { products, cartons } = data ?? loadPreliminaryQuoteData()
  const item = products.find((entry) => entry.sku === row.sku)
  if (!item) throw fallbackError
  const size = [...item.productDimensionsMm].sort((a, b) => b - a)
  const candidates = cartons.filter((c) => {
    const inner = [c.innerLengthMm, c.innerWidthMm, c.innerHeightMm].sort((a, b) => b - a)
    return size.every((dimension, i) => dimension + MIN_CLEARANCE_PER_AXIS_MM <= inner[i])
  }).sort((a, b) => a.outerLengthMm * a.outerWidthMm * a.outerHeightMm - b.outerLengthMm * b.outerWidthMm * b.outerHeightMm)
  if (!candidates.length) throw new LogisticsDataError('PRELIMINARY_QUOTE_NO_REFERENCE_BOX_FITS')
  const box = candidates[0]
  const gross = item.productWeightG + box.estimatedTareWeightG + PROTECTION_RESERVE_G
  if (!Number.isSafeInteger(gross)) throw new LogisticsDataError('PRELIMINARY_QUOTE_PARCEL_INVALID')
  return {
    provisional: true,
    parcel: { weightG: gross, lengthMm: box.outerLengthMm, widthMm: box.outerWidthMm, heightMm: box.outerHeightMm },
  }
}
