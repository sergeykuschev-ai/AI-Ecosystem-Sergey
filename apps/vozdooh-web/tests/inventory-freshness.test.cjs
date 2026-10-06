/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { requireFreshOnecInventory } = require('../src/commerce/inventoryFreshness.ts')

async function withState(t, state) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vozdooh-freshness-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'state.json')
  await fs.writeFile(filename, JSON.stringify(state))
  return filename
}

test('fresh 1C watchdog state permits checkout', async (t) => {
  const now = Date.parse('2026-10-06T06:00:00Z')
  const filename = await withState(t, {
    checked_at: '2026-10-06T05:55:00Z',
    status: 'fresh',
    threshold_seconds: 2700,
    import_age_seconds: 300,
    offers_age_seconds: 290,
  })
  await requireFreshOnecInventory(filename, now)
})

test('stale, missing or stale-watchdog state fails closed', async (t) => {
  const now = Date.parse('2026-10-06T06:00:00Z')
  const stale = await withState(t, {
    checked_at: '2026-10-06T05:59:00Z',
    status: 'stale',
    threshold_seconds: 2700,
    import_age_seconds: 2800,
    offers_age_seconds: 2790,
  })
  await assert.rejects(() => requireFreshOnecInventory(stale, now), (error) => error.code === 'INVENTORY_STALE')

  const oldWatchdog = await withState(t, {
    checked_at: '2026-10-06T05:40:00Z',
    status: 'fresh',
    threshold_seconds: 2700,
    import_age_seconds: 100,
    offers_age_seconds: 100,
  })
  await assert.rejects(() => requireFreshOnecInventory(oldWatchdog, now), (error) => error.code === 'INVENTORY_STALE')
  await assert.rejects(() => requireFreshOnecInventory(path.join(os.tmpdir(), 'missing-vozdooh-freshness.json'), now), (error) => error.code === 'INVENTORY_STALE')
})
