const { test } = require('node:test')
const assert = require('node:assert/strict')
const { packVerifiedUnits } = require('../src/commerce/packing.ts')
const box = { id: 'measured-box-1', status: 'VERIFIED', innerLengthMm: 310, innerWidthMm: 120, innerHeightMm: 120, outerLengthMm: 330, outerWidthMm: 140, outerHeightMm: 140, tareWeightG: 140, maxGrossWeightG: 2000 }
const item = (sku, lengthMm, widthMm, heightMm, weightG) => ({ sku, dimensions: { lengthMm, widthMm, heightMm, weightG } })
test('measured carton contains two items without stacking or imaginary volume', () => {
  assert.deepEqual(packVerifiedUnits([item('a', 150, 90, 90, 300), item('b', 140, 90, 90, 250)], [box]), {
    cartonId: 'measured-box-1', parcel: { weightG: 690, lengthMm: 330, widthMm: 140, heightMm: 140 },
  })
})
test('rotates a product to fit a verified carton', () => {
  const result = packVerifiedUnits([item('a', 90, 150, 90, 300)], [box])
  assert.equal(result.parcel.weightG, 440)
})
test('rejects missing cartons, invalid dimensions, overweight and impossible fit', () => {
  assert.throws(() => packVerifiedUnits([item('a', 150, 90, 90, 300)], []), /PACKING_VERIFIED_CARTON_MISSING/)
  assert.throws(() => packVerifiedUnits([item('a', 150, 90, 90, 0)], [box]), /PACKING_PRODUCT_DIMENSIONS_INVALID/)
  assert.throws(() => packVerifiedUnits([item('a', 150, 90, 90, 1900)], [box]), /PACKING_NO_VERIFIED_CARTON_FITS/)
  assert.throws(() => packVerifiedUnits([item('a', 250, 90, 90, 300), item('b', 250, 90, 90, 300)], [box]), /PACKING_NO_VERIFIED_CARTON_FITS/)
  assert.throws(() => packVerifiedUnits([item('a', 150, 90, 90, 300)], [{ ...box, innerLengthMm: 400 }]), /PACKING_CARTON_INVALID/)
})

test('multi-SKU logistics uses measured cartons and refuses unmeasured defaults', () => {
  const { parcelForOrder } = require('../src/commerce/logisticsDataset.ts')
  const order = { lines: [{ sku: 'a', quantity: 1 }, { sku: 'b', quantity: 1 }] }
  const rows = new Map([['a', { weightG: 300, lengthMm: 150, widthMm: 90, heightMm: 90 }], ['b', { weightG: 250, lengthMm: 140, widthMm: 90, heightMm: 90 }]])
  assert.throws(() => parcelForOrder(order, rows), /PACKING_VERIFIED_CARTON_MISSING/)
  assert.deepEqual(parcelForOrder(order, rows, [box]), { weightG: 690, lengthMm: 330, widthMm: 140, heightMm: 140 })
  assert.deepEqual(parcelForOrder({ lines: [{ sku: 'a', quantity: 1 }] }, rows), { weightG: 300, lengthMm: 150, widthMm: 90, heightMm: 90 })
  assert.throws(() => parcelForOrder({ lines: [{ sku: 'missing', quantity: 1 }, { sku: 'b', quantity: 1 }] }, rows, [box]), /LOGISTICS_SKU_NOT_VERIFIED/)
})
