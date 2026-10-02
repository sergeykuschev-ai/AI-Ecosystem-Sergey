import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import type { OrderRequest, OrderRequestStore } from './orderRequests'

export type OrderMailEvent =
  | 'request_received'
  | 'payment_confirmed'
  | 'delivery_created'
  | 'delivery_ready'
  | 'completed'
  | 'cancelled'
  | 'refunded'

type OutboxStatus = 'pending' | 'retry' | 'sent' | 'skipped'
type OutboxRecord = {
  version: 1
  orderId: string
  event: OrderMailEvent
  status: OutboxStatus
  attempts: number
  createdAt: string
  nextAttemptAt?: string
  sentAt?: string
  skipReason?: 'order_missing' | 'email_missing'
  lastError?: string
}

type RenderedMail = { to: string; subject: string; text: string; html: string }

const events: Record<OrderMailEvent, { title: string; intro: string }> = {
  request_received: {
    title: 'Заказ создан',
    intro: 'Мы получили ваш заказ. После подтверждения оплаты отправим отдельное уведомление.',
  },
  payment_confirmed: {
    title: 'Оплата подтверждена',
    intro: 'Оплата получена. Мы начинаем подготовку заказа к передаче в доставку.',
  },
  delivery_created: {
    title: 'Заказ передан в Ozon Доставку',
    intro: 'Отправление создано и передано в Ozon Доставку.',
  },
  delivery_ready: {
    title: 'Заказ прибыл в пункт выдачи',
    intro: 'Заказ готов к получению в выбранном пункте выдачи.',
  },
  completed: {
    title: 'Заказ получен',
    intro: 'Спасибо за покупку в VOZDOOH.',
  },
  cancelled: {
    title: 'Заказ отменён',
    intro: 'Заказ отменён. Если оплата уже была проведена, информация о возврате придёт отдельно.',
  },
  refunded: {
    title: 'Возврат оформлен',
    intro: 'Возврат по заказу оформлен. Срок зачисления зависит от банка.',
  },
}

const money = (minor: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(minor / 100)

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)

const outboxDirectory = () => resolve(/* turbopackIgnore: true */ process.env.MAIL_OUTBOX_PATH ?? '.local/email-outbox')
const outboxFile = (orderId: string, event: OrderMailEvent) => join(outboxDirectory(), `${orderId}.${event}.json`)

async function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, path)
}

export async function queueOrderMail(order: OrderRequest, event: OrderMailEvent) {
  if (!order.input.contact.email) return false
  const directory = outboxDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const record: OutboxRecord = {
    version: 1,
    orderId: order.id,
    event,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  }

  try {
    await writeFile(outboxFile(order.id, event), JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

export function renderOrderMail(order: OrderRequest, event: OrderMailEvent): RenderedMail {
  const email = order.input.contact.email
  if (!email) throw new Error('ORDER_EMAIL_MISSING')
  const copy = events[event]
  const number = order.id.slice(0, 8).toUpperCase()
  const deliveryLabel = order.input.delivery.method === 'ozon-pvz'
    ? `Пункт Ozon: ${order.input.delivery.address}`
    : order.input.delivery.method === 'courier'
      ? `Курьер: ${order.input.delivery.address}`
      : 'Получение: самовывоз'
  const itemLines = order.lines.map((line) =>
    `${line.name} × ${line.quantity} — ${money(line.totalMinor)}`,
  )
  const text = [
    `VOZDOOH — ${copy.title}`,
    '',
    `Заказ №${number}`,
    copy.intro,
    '',
    ...itemLines,
    '',
    `Итого: ${money(order.totalMinor)}`,
    deliveryLabel,

    '',
    'По вопросам заказа: vozdooh.kms@yandex.ru',
    'https://vozdooh27.ru',
  ].join('\n')
  const itemsHtml = order.lines
    .map((line) => `<li style="margin:0 0 8px">${escapeHtml(line.name)} × ${line.quantity} — <b>${escapeHtml(money(line.totalMinor))}</b></li>`)
    .join('')
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5">
    <div style="max-width:620px;margin:0 auto;padding:32px 20px">
      <p style="letter-spacing:.16em;font-size:12px">VOZDOOH</p>
      <h1 style="font-size:26px;margin:8px 0 20px">${escapeHtml(copy.title)}</h1>
      <p><b>Заказ №${number}</b></p>
      <p>${escapeHtml(copy.intro)}</p>
      <ul style="padding-left:20px">${itemsHtml}</ul>
      <p><b>Итого: ${escapeHtml(money(order.totalMinor))}</b></p>
      <p>${escapeHtml(deliveryLabel)}</p>
      <hr style="border:0;border-top:1px solid #ddd;margin:28px 0">
      <p style="font-size:13px">По вопросам заказа: <a href="mailto:vozdooh.kms@yandex.ru">vozdooh.kms@yandex.ru</a><br>
      <a href="https://vozdooh27.ru">vozdooh27.ru</a></p>
    </div>
  </body></html>`
  return { to: email, subject: `VOZDOOH — ${copy.title} · заказ №${number}`, text, html }
}

async function optionalSecret(envName: string, fileEnvName: string) {
  const direct = process.env[envName]?.trim()
  if (direct) return direct
  const filename = process.env[fileEnvName]?.trim()
  if (!filename) return undefined
  const value = (await readFile(filename, 'utf8')).trim()
  return value || undefined
}

export async function sendOrderMail(order: OrderRequest, event: OrderMailEvent) {
  const message = renderOrderMail(order, event)
  const host = process.env.SMTP_HOST?.trim()
  if (!host) throw new Error('SMTP_NOT_CONFIGURED')
  const port = Number(process.env.SMTP_PORT ?? '25')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT_INVALID')
  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  const user = process.env.SMTP_USER?.trim()
  const pass = user ? await optionalSecret('SMTP_PASSWORD', 'SMTP_PASSWORD_FILE') : undefined
  if (user && !pass) throw new Error('SMTP_PASSWORD_MISSING')
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    ignoreTLS: process.env.SMTP_IGNORE_TLS === 'true',
    auth: user && pass ? { user, pass } : undefined,
  })
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM?.trim() || 'VOZDOOH <orders@vozdooh27.ru>',
      replyTo: process.env.MAIL_REPLY_TO?.trim() || 'vozdooh.kms@yandex.ru',
      to: message.to,

      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { 'X-Auto-Response-Suppress': 'All' },
    })
  } finally {
    transport.close()
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'MAIL_SEND_ERROR'
  const value = error as { code?: unknown; name?: unknown }
  if (typeof value.code === 'string' && value.code) return value.code.slice(0, 64)
  if (typeof value.name === 'string' && value.name) return value.name.slice(0, 64)
  return 'MAIL_SEND_ERROR'
}

const validEvent = (value: unknown): value is OrderMailEvent =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(events, value)

export async function processMailOutbox(
  store: OrderRequestStore,
  options: { sender?: typeof sendOrderMail; now?: () => Date } = {},
) {
  const sender = options.sender ?? sendOrderMail
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
      if (record.version !== 1 || typeof record.orderId !== 'string' || !validEvent(record.event)) continue
      if (record.status === 'sent' || record.status === 'skipped') continue
      if (record.nextAttemptAt && Date.parse(record.nextAttemptAt) > now().getTime()) continue
    } catch {
      continue
    }
    const order = await store.findById(record.orderId)
    if (!order || !order.input.contact.email) {
      record.status = 'skipped'
      record.skipReason = order ? 'email_missing' : 'order_missing'
      await atomicWrite(path, record)
      result.skipped += 1
      continue
    }
    try {
      await sender(order, record.event)
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
