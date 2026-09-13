const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  validateAssortmentMatrix,
  matchAssortmentMatrix,
} = require('../services/assortment_matrix_loader');
const {
  ProductAliasError,
  loadProductAliases,
  buildAliasIndex,
  resolveConfirmedAlias,
} = require('../services/product_alias_resolver');

const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'product-alias-test-')
);

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function matrixItem(overrides = {}) {
  return {
    article: 'A-1',
    name: 'Тестовый товар 100 г',
    brand: 'Test',
    category: 'Test category',
    priority: 'standard',
    minimum_shelf_stock: 1,
    target_stock: 2,
    allow_zero_stock: false,
    notes: 'Test item',
    ...overrides,
  };
}

function matrix(items = [matrixItem()]) {
  return validateAssortmentMatrix({
    version: 1,
    updated_at: '2026-09-09',
    store: 'Миска',
    items,
  });
}

function row(overrides = {}) {
  const article = Object.hasOwn(overrides, 'article') ? overrides.article : 'A-1';
  const name = overrides.name || 'Тестовый товар 100 г';
  const rowNumber = overrides.rowNumber || 4;
  return {
    rowIdentity: overrides.rowIdentity || `report:sheet:${rowNumber}`,
    rowNumber,
    article,
    name,
    supplier: overrides.supplier || 'Test Supplier',
    priceNum: 100,
    sumNum: 100,
    stockStatus: overrides.stockStatus || null,
    finalRecommendedQuantity: 3,
    matchingHints: {
      barcode: overrides.barcode || null,
      internalProductId: overrides.internalProductId || null,
      supplier: overrides.supplier || 'Test Supplier',
      article,
      normalizedName: name.toLowerCase(),
    },
  };
}

function aliasRecord(overrides = {}) {
  return {
    supplier: 'Test Supplier',
    externalIdType: 'article',
    externalId: 'EXT-9',
    canonicalSkuId: 'A-1',
    canonicalName: 'Тестовый товар 100 г',
    source: 'safe-matching-recovery-test',
    evidence: ['test evidence: supplier code cross-reference'],
    status: 'confirmed',
    createdAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

function matchWithAliases(m, rows, aliases) {
  const aliasIndex = buildAliasIndex({ aliases: aliases || [] });
  return matchAssortmentMatrix(m, rows, { aliasIndex });
}

function statusFor(matchResult, rowIdentity) {
  const entry = matchResult.itemResults.find(result =>
    (result.candidateRowIdentities || []).includes(rowIdentity)
  );
  return entry
    ? { status: entry.status, matchMethod: entry.matchMethod }
    : { status: 'unmatched', matchMethod: null };
}

test('confirmed alias matches row to canonical SKU', () => {
  const m = matrix();
  const sourceRow = row({ article: 'EXT-9', name: 'Товар внешний 100 г', rowNumber: 10 });
  const result = matchWithAliases(m, [sourceRow], [aliasRecord()]);
  const byRow = result.matchesByRowIdentity.get(sourceRow.rowIdentity);
  assert.equal(byRow.matchMethod, 'confirmed_alias');
  assert.equal(byRow.item.article, 'A-1');
  assert.equal(byRow.alias.status, 'confirmed');
});

test('alias of one supplier does not apply to another supplier', () => {
  const m = matrix();
  const sourceRow = row({
    article: 'EXT-9',
    name: 'Товар внешний 100 г',
    supplier: 'Другой поставщик',
    rowNumber: 11,
  });
  const result = matchWithAliases(m, [sourceRow], [aliasRecord()]);
  assert.equal(result.matchesByRowIdentity.has(sourceRow.rowIdentity), false);
  assert.equal(statusFor(result, sourceRow.rowIdentity).status, 'unmatched');
});

test('valta legal-name variants share one alias scope', () => {
  const m = matrix();
  const sourceRow = row({
    article: 'EXT-9',
    supplier: 'АО "Валта пет продактс"',
    rowNumber: 12,
  });
  const valtaAlias = aliasRecord({
    supplier: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ВАЛТА ПЕТ ПРОДАКТС"',
  });
  const result = matchWithAliases(m, [sourceRow], [valtaAlias]);
  const byRow = result.matchesByRowIdentity.get(sourceRow.rowIdentity);
  assert.equal(byRow.matchMethod, 'confirmed_alias');
});

test('duplicate article stays ambiguous and picks no SKU', () => {
  const m = matrix([matrixItem({
    article: 'DUP-1',
    name: 'Лакомство дубль 85 г',
    notes: 'Item carrying the duplicated article',
  })]);
  const first = row({ article: 'DUP-1', name: 'Вкус один 85 г', rowNumber: 20 });
  const second = row({ article: 'DUP-1', name: 'Вкус два 85 г', rowNumber: 21 });
  const result = matchWithAliases(m, [first, second], []);
  assert.equal(statusFor(result, first.rowIdentity).status, 'ambiguous');
  assert.equal(statusFor(result, second.rowIdentity).status, 'ambiguous');
  assert.equal(result.matchesByRowIdentity.has(first.rowIdentity), false);
  assert.equal(result.matchesByRowIdentity.has(second.rowIdentity), false);
});

test('article alias cannot resolve a duplicated article', () => {
  const m = matrix([matrixItem({
    article: 'DUP-1',
    name: 'Лакомство дубль 85 г',
    notes: 'Item carrying the duplicated article',
  })]);
  const first = row({ article: 'DUP-1', name: 'Вкус один 85 г', rowNumber: 22 });
  const second = row({ article: 'DUP-1', name: 'Вкус два 85 г', rowNumber: 23 });
  const dupAlias = aliasRecord({
    externalId: 'DUP-1',
    evidence: ['test: duplicated supplier article'],
  });
  const result = matchWithAliases(m, [first, second], [dupAlias]);
  assert.equal(statusFor(result, first.rowIdentity).status, 'ambiguous');
  assert.equal(statusFor(result, second.rowIdentity).status, 'ambiguous');
  assert.equal(result.matchesByRowIdentity.has(first.rowIdentity), false);
  assert.equal(result.matchesByRowIdentity.has(second.rowIdentity), false);
});

test('barcode alias resolves the correct SKU', () => {
  const m = matrix([matrixItem(), matrixItem({ article: 'B-1', name: 'Другой товар' })]);
  const first = row({
    article: 'EXT-9', name: 'Товар внешний 100 г', barcode: '460001', rowNumber: 24,
  });
  const second = row({
    article: 'EXT-10', name: 'Товар чужой 100 г', barcode: '460002', rowNumber: 25,
  });
  const barcodeAlias = aliasRecord({
    externalIdType: 'barcode',
    externalId: '460001',
    canonicalSkuId: 'B-1',
    canonicalName: 'Другой товар',
    evidence: ['test: barcode scanned on shelf label'],
  });
  const result = matchWithAliases(m, [first, second], [barcodeAlias]);
  const byRow = result.matchesByRowIdentity.get(first.rowIdentity);
  assert.equal(byRow.matchMethod, 'confirmed_alias');
  assert.equal(byRow.item.article, 'B-1');
  assert.equal(result.matchesByRowIdentity.has(second.rowIdentity), false);
});

test('barcode alias disambiguates a duplicated article for the remaining row', () => {
  const m = matrix([
    matrixItem({ article: 'DUP-1', name: 'Лакомство дубль 85 г' }),
    matrixItem({ article: 'B-1', name: 'Другой товар' }),
  ]);
  const first = row({
    article: 'DUP-1', name: 'Вкус один 85 г', barcode: '460001', rowNumber: 26,
  });
  const second = row({
    article: 'DUP-1', name: 'Вкус два 85 г', barcode: '460002', rowNumber: 27,
  });
  const barcodeAlias = aliasRecord({
    externalIdType: 'barcode',
    externalId: '460001',
    canonicalSkuId: 'B-1',
    canonicalName: 'Другой товар',
    evidence: ['test: barcode scanned on shelf label'],
  });
  const result = matchWithAliases(m, [first, second], [barcodeAlias]);
  assert.equal(
    result.matchesByRowIdentity.get(first.rowIdentity).matchMethod,
    'confirmed_alias'
  );
  const secondMatch = result.matchesByRowIdentity.get(second.rowIdentity);
  assert.equal(secondMatch.matchMethod, 'article');
  assert.equal(secondMatch.item.article, 'DUP-1');
});


test('confirmed productName alias matches missing-article row by exact normalized name', () => {
  const m = matrix();
  const sourceRow = row({
    article: null,
    name: '  ТЕСТОВЫЙ товар, 100 г  ',
    rowNumber: 28,
  });
  const nameAlias = aliasRecord({
    externalIdType: 'productName',
    externalId: 'Тестовый товар 100 г',
    evidence: ['test: exact normalized supplier product name'],
  });
  const result = matchWithAliases(m, [sourceRow], [nameAlias]);
  const byRow = result.matchesByRowIdentity.get(sourceRow.rowIdentity);
  assert.equal(byRow.matchMethod, 'confirmed_alias');
  assert.equal(byRow.item.article, 'A-1');
});

test('productName alias cannot resolve a duplicated normalized name', () => {
  const m = matrix();
  const first = row({ article: null, name: 'Тестовый товар 100 г', rowNumber: 29 });
  const second = row({ article: null, name: 'Тестовый товар, 100 г', rowNumber: 30 });
  const nameAlias = aliasRecord({
    externalIdType: 'productName',
    externalId: 'Тестовый товар 100 г',
    evidence: ['test: duplicate normalized name must stay blocked'],
  });
  const result = matchWithAliases(m, [first, second], [nameAlias]);
  assert.equal(result.matchesByRowIdentity.has(first.rowIdentity), false);
  assert.equal(result.matchesByRowIdentity.has(second.rowIdentity), false);
});

test('real missing product stays unmatched without an alias', () => {
  const m = matrix();
  const sourceRow = row({ article: 'NOWHERE-1', name: 'Товар отсутствует', rowNumber: 30 });
  const result = matchWithAliases(m, [sourceRow], []);
  assert.equal(result.matchesByRowIdentity.has(sourceRow.rowIdentity), false);
  assert.equal(statusFor(result, sourceRow.rowIdentity).status, 'unmatched');
});

test('proposed alias is never applied automatically', () => {
  const m = matrix();
  const sourceRow = row({ article: 'EXT-9', name: 'Товар внешний 100 г', rowNumber: 31 });
  const proposed = aliasRecord({ status: 'proposed' });
  const result = matchWithAliases(m, [sourceRow], [proposed]);
  assert.equal(result.matchesByRowIdentity.has(sourceRow.rowIdentity), false);
  const aliasIndex = buildAliasIndex({ aliases: [proposed] });
  const direct = resolveConfirmedAlias(
    aliasIndex,
    sourceRow,
    new Map([['article:EXT-9', 1]]),
    new Map([['A-1', m.items]])
  );
  assert.equal(direct, null);
});

test('conflicting aliases pointing at different canonical SKUs are excluded', () => {
  const m = matrix([matrixItem(), matrixItem({ article: 'B-1', name: 'Другой товар' })]);
  const sourceRow = row({ article: 'EXT-9', name: 'Товар внешний 100 г', rowNumber: 32 });
  const index = buildAliasIndex({
    aliases: [
      aliasRecord(),
      aliasRecord({ canonicalSkuId: 'B-1', canonicalName: 'Другой товар' }),
    ],
  });
  assert.equal(index.confirmedByExternal.size, 0);
  assert.equal(index.diagnostics.some(d => d.code === 'ALIAS_CONFLICT'), true);
  const result = matchAssortmentMatrix(m, [sourceRow], { aliasIndex: index });
  assert.equal(result.matchesByRowIdentity.has(sourceRow.rowIdentity), false);
});

test('alias resolution never mutates rows, quantities, ZERO_CONFIRMED or financial fields', () => {
  const m = matrix();
  const sourceRow = row({
    article: 'EXT-9',
    rowNumber: 40,
    stockStatus: 'confirmed_zero',
  });
  const snapshot = structuredClone(sourceRow);
  const result = matchWithAliases(m, [sourceRow], [aliasRecord()]);
  assert.equal(result.matchesByRowIdentity.get(sourceRow.rowIdentity).matchMethod, 'confirmed_alias');
  assert.deepEqual(sourceRow, snapshot);
  assert.equal(sourceRow.finalRecommendedQuantity, 3);
  assert.equal(sourceRow.stockStatus, 'confirmed_zero');
  assert.equal(sourceRow.priceNum, 100);
  assert.equal(sourceRow.sumNum, 100);
});

test('exact article match takes precedence over a confirmed alias', () => {
  const m = matrix();
  const sourceRow = row({ article: 'A-1', rowNumber: 50 });
  const result = matchWithAliases(m, [sourceRow], [aliasRecord({
    externalId: 'A-1',
    evidence: ['test: same identifier as matrix article'],
  })]);
  const byRow = result.matchesByRowIdentity.get(sourceRow.rowIdentity);
  assert.equal(byRow.matchMethod, 'article');
});

test('loadProductAliases validates records and tolerates a missing file', () => {
  const missing = loadProductAliases(path.join(TEMP_DIRECTORY, 'nope.json'));
  assert.equal(missing.aliases.length, 0);
  assert.equal(missing.diagnostics.some(d => d.code === 'ALIAS_FILE_NOT_FOUND'), true);

  const filePath = path.join(TEMP_DIRECTORY, 'aliases.json');
  fs.writeFileSync(filePath, JSON.stringify({ aliases: [aliasRecord()] }));
  const loaded = loadProductAliases(filePath);
  assert.equal(loaded.aliases.length, 1);

  fs.writeFileSync(filePath, JSON.stringify({
    aliases: [aliasRecord({ status: 'auto' })],
  }));
  assert.throws(() => loadProductAliases(filePath), ProductAliasError);

  fs.writeFileSync(filePath, JSON.stringify({
    aliases: [aliasRecord({ evidence: [] })],
  }));
  assert.throws(() => loadProductAliases(filePath), ProductAliasError);
});
