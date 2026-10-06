/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS production worker bootstrap. */
const fs = require('node:fs/promises')
const path = require('node:path')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const { reconcileOzonPayment } = require('../src/commerce/paymentReconciliation.ts')
const { processMailOutbox } = require('../src/commerce/orderMail.ts')
const { queueOrderNotification, processOrderNotificationOutbox } = require('../src/commerce/orderNotifications.ts')
const { parcelForOrder } = require('../src/commerce/logisticsDataset.ts')
const { createConfiguredOzonPickupDelivery } = require('../src/commerce/ozonDeliveryBusiness.ts')

const orderDirectory = path.resolve(process.env.ORDER_REQUEST_STORE_PATH || '.local/order-requests')
const intervalMs = Number(process.env.COMMERCE_WORKER_INTERVAL_MS || '15000')
if (!Number.isSafeInteger(intervalMs) || intervalMs < 5000) throw new Error('COMMERCE_WORKER_INTERVAL_INVALID')
const notificationStartedAt = Date.parse(process.env.ARTHUR_ORDER_NOTIFICATIONS_STARTED_AT || '')
const notificationsEnabledFor = (order) => Number.isFinite(notificationStartedAt) &&
  order.payment?.status === 'PAID' && Number.isFinite(Date.parse(order.payment.paidAt || '')) &&
  Date.parse(order.payment.paidAt) >= notificationStartedAt
const deliveryMutationsStartedAt = Date.parse(process.env.OZON_DELIVERY_MUTATIONS_STARTED_AT || '')
const deliveryMutationsEnabledFor = (order) => Number.isFinite(deliveryMutationsStartedAt) &&
  order.payment?.status === 'PAID' && Number.isFinite(Date.parse(order.payment.paidAt || '')) &&
  Date.parse(order.payment.paidAt) >= deliveryMutationsStartedAt
const store = localRequestStore(orderDirectory)
let stopped = false

async function listOrders() {
  let names = []
  try {
    names = await fs.readdir(orderDirectory)
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const orders = []
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue
    const key = name.slice(0, -5)
    try {
      const order = await store.find(key)
      if (order) orders.push(order)
    } catch {
      console.error('COMMERCE_WORKER_ORDER_READ_FAILED')
    }
  }
  return orders
}

async function tick() {
  const orders = await listOrders()
  let reconciled = 0
  for (const order of orders) {
    if (order.payment?.status !== 'PAYMENT_NEW') continue
    if (!order.payment.redirectUrl.includes('checkout.ozon.ru/order')) continue
    if (Date.now() - Date.parse(order.payment.createdAt) > 24 * 60 * 60 * 1000) continue
    try {
      const result = await reconcileOzonPayment(order.id, store)
      if (result.state === 'paid' && result.changed) reconciled += 1
    } catch {
      console.error('OZON_PAYMENT_RECONCILE_FAILED')
    }
  }
  let deliveries = 0
  for (const order of await listOrders()) {
    if (notificationsEnabledFor(order)) {
      try {
        await queueOrderNotification(order, 'payment_confirmed')
        if (order.deliveryOrder?.status === 'created') await queueOrderNotification(order, 'delivery_created')
      } catch {
        console.error('ARTHUR_ORDER_NOTIFICATION_QUEUE_FAILED')
      }
    }
    if (order.payment?.status !== 'PAID' || order.input.delivery.method !== 'ozon-pvz' || order.deliveryOrder?.status === 'created') continue
    try {
      const parcel = parcelForOrder(order)
      if (process.env.OZON_DELIVERY_MUTATIONS_ENABLED !== 'true' || !deliveryMutationsEnabledFor(order)) continue
      const result = await createConfiguredOzonPickupDelivery(order.id, store, parcel)
      if (result.changed) deliveries += 1
    } catch (error) {
      const code = error?.code || 'UNKNOWN'
      console.error('OZON_DELIVERY_CREATE_FAILED', code)
      if (notificationsEnabledFor(order)) {
        try {
          await queueOrderNotification(order, 'delivery_failed', code)
        } catch {
          console.error('ARTHUR_ORDER_NOTIFICATION_QUEUE_FAILED')
        }
      }
    }
  }
  let mail = { sent: 0, failed: 0, skipped: 0 }
  try {
    mail = await processMailOutbox(store)
  } catch {
    console.error('ORDER_MAIL_OUTBOX_FAILED')
  }
  let notifications = { sent: 0, failed: 0, skipped: 0 }
  try {
    notifications = await processOrderNotificationOutbox(store)
  } catch {
    console.error('ARTHUR_ORDER_NOTIFICATION_OUTBOX_FAILED')
  }
  if (reconciled || deliveries || mail.sent || mail.failed || mail.skipped || notifications.sent || notifications.failed || notifications.skipped) {
    console.info('COMMERCE_WORKER_TICK', { reconciled, deliveries, mail, notifications })
  }
}

async function loop() {
  while (!stopped) {
    try {
      await tick()
    } catch {
      console.error('COMMERCE_WORKER_TICK_FAILED')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

process.on('SIGTERM', () => { stopped = true })
process.on('SIGINT', () => { stopped = true })
loop().catch(() => {
  console.error('COMMERCE_WORKER_FATAL')
  process.exitCode = 1
})
