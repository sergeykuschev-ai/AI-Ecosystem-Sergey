import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type FreshnessState = {
  checked_at?: unknown
  status?: unknown
  threshold_seconds?: unknown
  import_age_seconds?: unknown
  offers_age_seconds?: unknown
}

export class InventoryFreshnessError extends Error {
  readonly code = 'INVENTORY_STALE'
  constructor() { super('INVENTORY_STALE') }
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Fail closed when the host-side 1C freshness watchdog is missing, stale or
 * reports source CommerceML older than its configured threshold.
 */
export async function requireFreshOnecInventory(
  path = process.env.ONEC_FRESHNESS_STATE_PATH ?? '/opt/vozdooh/data/onec-freshness.json',
  now = Date.now(),
) {
  try {
    const raw = JSON.parse(await readFile(resolve(/* turbopackIgnore: true */ path), 'utf8')) as FreshnessState
    const checkedAt = typeof raw.checked_at === 'string' ? Date.parse(raw.checked_at) : Number.NaN
    const threshold = raw.threshold_seconds
    const importAge = raw.import_age_seconds
    const offersAge = raw.offers_age_seconds
    // The watchdog runs every five minutes. Ten minutes without a new check
    // means the watchdog itself is no longer trustworthy.
    const watchdogAge = now - checkedAt
    if (
      raw.status !== 'fresh' ||
      !Number.isFinite(checkedAt) ||
      watchdogAge < 0 ||
      watchdogAge > 10 * 60 * 1000 ||
      !finiteNonNegative(threshold) ||
      threshold <= 0 ||
      !finiteNonNegative(importAge) ||
      !finiteNonNegative(offersAge) ||
      importAge > threshold ||
      offersAge > threshold
    ) throw new InventoryFreshnessError()
  } catch (error) {
    if (error instanceof InventoryFreshnessError) throw error
    throw new InventoryFreshnessError()
  }
}
