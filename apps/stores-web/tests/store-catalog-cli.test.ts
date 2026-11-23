import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXPECTED_1C_WAREHOUSES } from '../lib/store-catalog/import-contract';

const script = resolve('scripts/store-catalog/prepare-import.ts');
const org = '12345678-1234-1234-1234-123456789012';
const kind = '87654321-1234-1234-1234-123456789012';
const now = new Date();
const ts = new Date(now.getTime() - 2 * 60000).toISOString();
const approved = {
  schemaVersion: 1, approvalState: 'verified-by-owner', store: 'amper',
  currency: 'RUB', warehouseRef: EXPECTED_1C_WAREHOUSES.amper,
  organizationRef: org, retailPriceTypeRef: kind,
  reviewedAt: ts, reviewEvidence: 'SYNTHETIC TEST DATA — NEVER USE IN PRODUCTION',
};
const raw = {
  schemaVersion: 1, source: '1c-ut-verified-store-export', store: 'amper',
  currency: 'RUB', warehouseRef: EXPECTED_1C_WAREHOUSES.amper,
  organizationRef: org, retailPriceTypeRef: kind,
  completeness: 'all-active-sellable-items',
  priceMethod: '1c-effective-retail-price-with-vat',
  stockMethod: '1c-free-to-sell-current-balance',
  registerState: 'reconciled', exportedAt: ts, stockAsOf: ts, pricesAsOf: ts,
  products: [{
    refKey: 'abcdef12-3456-7890-1234-567890abcdef',
    name: 'ТЕСТ — кабель', category: 'ТЕСТОВЫЕ ТОВАРЫ',
    warehouseRef: EXPECTED_1C_WAREHOUSES.amper,
    organizationRef: org, retailPriceTypeRef: kind,
    priceRub: 45.9, freeStockQuantity: 7,
    isFolder: false, deletionMark: false, sellable: true,
  }],
};

test('CLI defaults to read-only, and stages only under catalog-staging with unique name', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'catalog-cli-test-'));
  try {
    const dataFile = join(temp, 'raw.json');
    const mappingFile = join(temp, 'mapping.json');
    const staging = join(temp, 'catalog-staging');
    await mkdir(staging);
    await writeFile(dataFile, JSON.stringify(raw));
    await writeFile(mappingFile, JSON.stringify(approved));
    const base = ['--input', dataFile, '--mapping', mappingFile];

    const dry = spawnSync(process.execPath, ['--import', 'tsx', script, ...base], { encoding: 'utf8', timeout: 15000 });
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).status, 'VALIDATED_STAGING_ONLY');
    assert.deepEqual(await readdir(staging), []);

    const bad = spawnSync(process.execPath, ['--import', 'tsx', script, ...base, '--write-staging', '--out', temp],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Only catalog-staging/);
    assert.deepEqual(await readdir(staging), []);

    const good = spawnSync(process.execPath,
      ['--import', 'tsx', script, ...base, '--write-staging', '--out', staging],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(good.status, 0, good.stderr);
    const status = JSON.parse(good.stdout);
    assert.equal(status.productionUpdated, false);
    assert.equal(status.store, 'amper');
    const files = await readdir(staging);
    assert.equal(files.length, 1);
    assert.match(files[0], /^amper-\d+-[a-f0-9]{12}\.candidate\.json$/);
    const snapshot = JSON.parse(await readFile(join(staging, files[0]), 'utf8'));
    assert.equal(snapshot.products[0].priceRub, 45.9);
    assert.equal(snapshot.store, 'amper');
    assert.equal(files.some(f => f === 'amper.json'), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
