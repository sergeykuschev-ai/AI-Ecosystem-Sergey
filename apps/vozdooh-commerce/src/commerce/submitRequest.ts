export type RequestReceipt = { id: string; totalMinor: number; createdAt: string; currency: 'RUB'; status: 'request_received' }

/** A timeout is an unknown outcome: callers must retain their existing retry key. */
export async function submitRequest(payload: unknown, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<RequestReceipt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher('/api/order-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok) {
      const error = new Error('REQUEST_NOT_CONFIRMED') as Error & { code?: string }
      if (result && typeof result.code === 'string') error.code = result.code
      throw error
    }
    if (!result || typeof result.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.id) ||
        !Number.isSafeInteger(result.totalMinor) || result.totalMinor <= 0 ||
        typeof result.createdAt !== 'string' || !Number.isFinite(Date.parse(result.createdAt)) ||
        result.currency !== 'RUB' || result.status !== 'request_received') throw new Error('INVALID_RECEIPT')
    return result
  } finally { clearTimeout(timer) }
}
