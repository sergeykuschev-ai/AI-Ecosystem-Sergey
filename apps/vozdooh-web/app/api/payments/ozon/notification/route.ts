import { NextResponse } from 'next/server'
import { loadOzonCredentials, verifyOzonNotification, type OzonNotification } from '../../../../../src/commerce/ozonAcquiring'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let body: OzonNotification
  try {
    body = (await request.json()) as OzonNotification
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  let secret: string
  try { secret = (await loadOzonCredentials()).notificationSecret } catch {
    console.error('Ozon acquiring notification secret is not configured')
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  if (!verifyOzonNotification(body, secret)) {
    console.warn('Rejected Ozon acquiring notification with invalid signature')
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 })
  }

  // Signature is verified before any future order-state mutation.
  // Payment/order persistence is enabled together with the acquiring token.
  console.info('Verified Ozon acquiring notification', {
    orderID: body.orderID ?? null,
    extOrderID: body.extOrderID ?? null,
    extTransactionID: body.extTransactionID ?? null,
  })
  return NextResponse.json({ ok: true })
}
