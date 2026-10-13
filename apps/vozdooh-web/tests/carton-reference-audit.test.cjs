const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
const reference = JSON.parse(fs.readFileSync(path.join(root, 'research/data/estimated-cartons-market.json'), 'utf8'))
const verified = JSON.parse(fs.readFileSync(path.join(root, 'research/data/verified-cartons.json'), 'utf8'))
test('market carton weights remain clearly unverified planning data', () => {
  assert.equal(reference.status, 'REFERENCE_ONLY_NOT_VERIFIED')
  assert.equal(reference.cartons.length, 3)
  for (const carton of reference.cartons) {
    assert.equal(carton.status, 'ESTIMATED')
    assert.ok(carton.estimatedTareWeightG > 0)
    assert.ok(carton.estimatedTareWeightG >= carton.observedWeightRangeG[0])
    assert.ok(carton.sources.length > 0)
    assert.ok(!('tareWeightG' in carton))
  }
  assert.deepEqual(verified.cartons, [])
})
