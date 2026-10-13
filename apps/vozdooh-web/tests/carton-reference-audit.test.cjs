const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
const reference = JSON.parse(fs.readFileSync(path.join(root, 'research/data/estimated-cartons-market.json'), 'utf8'))
const verified = JSON.parse(fs.readFileSync(path.join(root, 'research/data/verified-cartons.json'), 'utf8'))
test('market carton weights remain clearly unverified planning data', () => {
  assert.equal(reference.status, 'REFERENCE_ONLY_NOT_VERIFIED')
  assert.equal(reference.cartons.length, 4)
  for (const carton of reference.cartons) {
    assert.equal(carton.status, 'ESTIMATED')
    assert.ok(carton.estimatedTareWeightG > 0)
    assert.ok(carton.estimatedTareWeightG >= carton.observedWeightRangeG[0])
    assert.ok(carton.sources.length > 0)
    assert.ok(!('tareWeightG' in carton))
  }
  assert.deepEqual(verified.cartons, [])
})

test('Africa 1200ml gift sets have a sourced large-box candidate, not a verified shipping box', () => {
  const box = reference.cartons.find((carton) => carton.id === 'reference-600x200x200')
  assert.ok(box)
  assert.deepEqual([box.innerLengthMm, box.innerWidthMm, box.innerHeightMm], [600, 200, 200])
  assert.equal(box.estimatedTareWeightG, 240)
  assert.equal(box.status, 'ESTIMATED')
  assert.equal(verified.cartons.length, 0)
})
