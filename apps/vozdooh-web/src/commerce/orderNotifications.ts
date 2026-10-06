import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { OrderRequest, OrderRequestStore } from './orderRequests'

export type OrderNotificationEvent = 'payment_confirmed' | 'delivery_created' | 'delivery_failed'
type OutboxStatus = 'pending' | 'retry' | 'sent' | 'skipped'
type OutboxRecord = {
  version: 1
  eventId: string
  orderId: string
  event: OrderNotificationEvent
  status: OutboxStatus
  attempts: number
  createdAt: string
  reason?: string
  nextAttemptAt?: string
  sentAt?: string
  skipReason?: 'order_missing'
  lastError?: string
}

type Sender = (input: { eventId: string; event: OrderNotificationEvent; order: OrderRequest; reason?: string }) => Promise<void>

const outboxDirectory = () => resolve(/* turbopackIgnore: true */ process.env.ARTHUR_NOTIFICATION_OUTBOX_PATH ?? '.local/arthur-notification-outbox')
const outboxFile = (orderId: string, event: OrderNotificationEvent) => join(outboxDirectory(), `${orderId}.${event}.json`)

async function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, path)
}

function validEvent(value: unknown): value is OrderNotificationEvent {
  return value === 'payment_confirmed' || value === 'delivery_created' || value === 'delivery_failed'
}

function safeReason(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(value)) return undefined
  return value
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'ARTHUR_NOTIFICATION_SEND_FAILED'
  const value = error as { code?: unknown; name?: unknown }
  if (typeof value.code === 'string' && value.code) return value.code.slice(0, 80)
  if (typeof value.name === 'string' && value.name) return value.name.slice(0, 80)
  return 'ARTHUR_NOTIFICATION_SEND_FAILED'
}

export async function queueOrderNotification(order: OrderRequest, event: OrderNotificationEvent, reason?: string) {
  const directory = outboxDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const record: OutboxRecord = {
    version: 1,
    eventId: randomUUID(),
    orderId: order.id,
    event,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    ...(safeReason(reason) ? { reason: safeReason(reason) } : {}),
  }
  try {
    await writeFile(outboxFile(order.id, event), JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

async function notificationSecret() {
  const direct = process.env.ARTHUR_VOZDOOH_NOTIFICATION_SECRET?.trim()
  if (direct) return direct
  const filename = process.env.ARTHUR_VOZDOOH_NOTIFICATION_SECRET_FILE?.trim()
  if (!filename) throw Object.assign(new Error('ARTHUR_NOTIFICATION_NOT_CONFIGURED'), { code: 'ARTHUR_NOTIFICATION_NOT_CONFIGURED' })
  const value = (await readFile(filename, 'utf8')).trim()
  if (!value) throw Object.assign(new Error('ARTHUR_NOTIFICATION_SECRET_MISSING'), { code: 'ARTHUR_NOTIFICATION_SECRET_MISSING' })
  return value
}

export async function sendOrderNotification(input: { eventId: string; event: OrderNotificationEvent; order: OrderRequest; reason?: string }) {
  const url = process.env.ARTHUR_VOZDOOH_NOTIFICATIONS_URL?.trim()
  if (!url) throw Object.assign(new Error('ARTHUR_NOTIFICATION_NOT_CONFIGURED'), { code: 'ARTHUR_NOTIFICATION_NOT_CONFIGURED' })
  const secret = await notificationSecret()
  const order = input.order
  const deliveryLabel = order.input.delivery.method === 'ozon-pvz'
    ? `ПВЗ Ozon: ${order.input.delivery.address}`
    : order.input.delivery.method === 'courier'
      ? `Курьер: ${order.input.delivery.address}`
      : 'Самовывоз'
  const payload = JSON.stringify({
    eventId: input.eventId,
    event: input.event,
    order: {
      id: order.id,
      number: order.id.slice(0, 8).toUpperCase(),
      totalMinor: order.totalMinor,
      customer: {
        name: order.input.contact.name,
        phone: order.input.contact.phone,
        ...(order.input.contact.email ? { email: order.input.contact.email } : {}),
      },
      deliveryLabel,
      items: order.lines.map((line) => ({ name: line.name, quantity: line.quantity, totalMinor: line.totalMinor })),
      ...(order.deliveryOrder?.postingNumber ? { postingNumber: order.deliveryOrder.postingNumber } : {}),
    },
    ...(input.reason ? { reason: input.reason } : {}),
  })
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vozdooh-signature': signature },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw Object.assign(new Error('ARTHUR_NOTIFICATION_TRANSPORT_FAILED'), { code: 'ARTHUR_NOTIFICATION_TRANSPORT_FAILED' })
  }
  if (!response.ok) throw Object.assign(new Error(`ARTHUR_NOTIFICATION_HTTP_${response.status}`), { code: `ARTHUR_NOTIFICATION_HTTP_${response.status}` })
}

export async function processOrderNotificationOutbox(
  store: OrderRequestStore,
  options: { sender?: Sender; now?: () => Date } = {},
) {
  const sender = options.sender ?? sendOrderNotification
  const now = options.now ?? (() => new Date())
  const directory = outboxDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const names = (await readdir(/* turbopackIgnore: true */ directory)).filter((name) => name.endsWith('.json')).sort()
  const result = { sent: 0, failed: 0, skipped: 0 }
  for (const name of names) {
    const path = join(/* turbopackIgnore: true */ directory, name)
    let record: OutboxRecord
    try {
      record = JSON.parse(await readFile(/* turbopackIgnore: true */ path, 'utf8')) as OutboxRecord
      if (record.version !== 1 || typeof record.eventId !== 'string' || typeof record.orderId !== 'string' || !validEvent(record.event)) continue
      if (record.status === 'sent' || record.status === 'skipped') continue
      if (record.nextAttemptAt && Date.parse(record.nextAttemptAt) > now().getTime()) continue
    } catch {
      continue
    }
    const order = await store.findById(record.orderId)
    if (!order) {
      record.status = 'skipped'
      record.skipReason = 'order_missing'
      await atomicWrite(path, record)
      result.skipped += 1
      continue
    }
    try {
      await sender({ eventId: record.eventId, event: record.event, order, reason: record.reason })
      record.status = 'sent'
      record.sentAt = now().toISOString()
      delete record.nextAttemptAt
      delete record.lastError
      await atomicWrite(path, record)
      result.sent += 1
    } catch (error) {
      record.status = 'retry'
      record.attempts += 1
      record.lastError = errorCode(error)
      const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(record.attempts - 1, 7))
      record.nextAttemptAt = new Date(now().getTime() + delaySeconds * 1000).toISOString()
      await atomicWrite(path, record)
      result.failed += 1
    }
  }
  return result
}
