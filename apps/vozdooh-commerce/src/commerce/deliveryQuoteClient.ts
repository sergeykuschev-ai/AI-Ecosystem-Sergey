/** Browser-only read-only Ozon delivery estimate. Never starts payments or shipments. */
export type DeliveryQuotePresentation = {
  estimatedTotalDeliveryRub: number
  estimatedCombinedTotalMinor: number
  estimatedDeliveryDays: number | null
  provisionalLogistics: boolean
}

type QuoteResponse = {
  code?: unknown
  productTotalMinor?: unknown
  estimatedTotalDeliveryRub?: unknown
  estimatedCombinedTotalMinor?: unknown
  estimatedDeliveryDays?: unknown
  deliveryIncludedInPayment?: unknown
  provisionalLogistics?: unknown
}

/** A tariff response must refer to the exact saved order and product total.
 * Shipping cannot silently slip into the actual Ozon Pay amount. */
export function validateQuoteResponse(result: QuoteResponse, productTotalMinor: number): DeliveryQuotePresentation {
  if (!Number.isSafeInteger(productTotalMinor) || productTotalMinor <= 0 ||
    result.deliveryIncludedInPayment !== false || result.productTotalMinor !== productTotalMinor ||
    typeof result.estimatedTotalDeliveryRub !== 'number' || !Number.isFinite(result.estimatedTotalDeliveryRub) ||
    result.estimatedTotalDeliveryRub <= 0 ||
    !Number.isSafeInteger(result.estimatedCombinedTotalMinor) ||
    result.estimatedCombinedTotalMinor !== productTotalMinor + Math.round(result.estimatedTotalDeliveryRub * 100) ||
    !(result.estimatedDeliveryDays === null || (typeof result.estimatedDeliveryDays === 'number' &&
      Number.isFinite(result.estimatedDeliveryDays) && result.estimatedDeliveryDays >= 0)) ||
    typeof result.provisionalLogistics !== 'boolean') {
    throw new Error('DELIVERY_QUOTE_INVALID')
  }
  return {
    estimatedTotalDeliveryRub: result.estimatedTotalDeliveryRub,
    estimatedCombinedTotalMinor: result.estimatedCombinedTotalMinor,
    estimatedDeliveryDays: result.estimatedDeliveryDays,
    provisionalLogistics: result.provisionalLogistics,
  }
}

export async function fetchOrderDeliveryQuote(
  requestId: string,
  productTotalMinor: number,
  fetcher: typeof fetch = fetch,
): Promise<DeliveryQuotePresentation> {
  const response = await fetcher('/api/ozon/delivery-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  })
  if (!response.ok) throw new Error('DELIVERY_QUOTE_UNAVAILABLE')
  const result = await response.json() as QuoteResponse
  return validateQuoteResponse(result, productTotalMinor)
}
