/* eslint-disable @typescript-eslint/no-require-imports -- read-only operations CLI. */
const path = require('node:path')
const { localRequestStore } = require('../src/commerce/localRequestStore.ts')
const { quoteOzonPickupDelivery } = require('../src/commerce/ozonDeliveryBusiness.ts')

function positiveInt(name, value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`INVALID_${name}`)
  return number
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`MISSING_${name.toUpperCase().replaceAll('-', '_')}`)
  return process.argv[index + 1]
}

async function main() {
  const orderId = option('order-id')
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('INVALID_ORDER_ID')
  const parcel = {
    weightG: positiveInt('WEIGHT_G', option('weight-g')),
    lengthMm: positiveInt('LENGTH_MM', option('length-mm')),
    widthMm: positiveInt('WIDTH_MM', option('width-mm')),
    heightMm: positiveInt('HEIGHT_MM', option('height-mm')),
  }
  const directory = path.resolve(process.env.ORDER_REQUEST_STORE_PATH || '.local/order-requests')
  const store = localRequestStore(directory)
  const order = await store.findById(orderId)
  if (!order) throw new Error('ORDER_NOT_FOUND')
  const quote = await quoteOzonPickupDelivery(order, parcel)
  console.log(JSON.stringify({
    orderId,
    parcel,
    quote,
  }, null, 2))
}

main().catch((error) => {
  console.error(error && error.code ? error.code : error && error.message ? error.message : 'OZON_DELIVERY_QUOTE_FAILED')
  process.exitCode = 1
})
