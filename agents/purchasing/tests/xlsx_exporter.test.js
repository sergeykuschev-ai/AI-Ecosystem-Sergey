'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { strFromU8, unzipSync } = require('fflate');

const {
  REMOVED_ITEMS_FILE_NAME,
  REMOVED_SHEET_NAME,
  SUPPLIER_ORDER_FILE_NAME,
  SUPPLIER_SHEET_NAME,
  XLSX_CONTENT_TYPE,
  buildOptimizedRemovedItemsXlsx,
  buildOptimizedSupplierOrderXlsx,
  createOptimizedXlsxFiles,
} = require('../../../shared/reporting/xlsx_exporter');

function optimizationFixture() {
  return {
    targetBudget: 50,
    originalTotal: 85.67,
    optimizedTotal: 45.67,
    removedAmount: 40,
    status: 'OPTIMIZED',
    items: [
      {
        sku: 'АРТ&1',
        name: 'Корм <Особый> для собак',
        decision: 'manual_review',
        privateTechnicalField: 'must_buy recommended',
        price: 10.25,
        originalQuantity: 3,
        optimizedQuantity: 2,
        optimizedAmount: 20.5,
      },
      {
        sku: 'SKU-2',
        name: 'Корм обычный',
        decision: 'must_buy',
        price: 25.17,
        originalQuantity: 1,
        optimizedQuantity: 1,
        optimizedAmount: 25.17,
      },
      {
        sku: 'ZERO',
        name: 'Не включать',
        decision: 'postpone',
        price: 1,
        originalQuantity: 1,
        optimizedQuantity: 0,
        optimizedAmount: 0,
      },
    ],
    removedItems: [
      {
        sku: 'REM-1',
        name: 'Исключённый товар',
        decision: 'postpone',
        originalQuantity: 2,
        removedQuantity: 2,
        removedAmount: 30,
      },
      {
        sku: 'REM-2',
        name: 'Исключённый товар 2',
        decision: 'manual_review',
        originalQuantity: 1,
        removedQuantity: 1,
        removedAmount: 10,
      },
    ],
  };
}

function unzip(buffer) {
  return unzipSync(buffer);
}

function xmlFile(archive, fileName) {
  return strFromU8(archive[fileName]);
}

test('XLSX files use ZIP signature and required OOXML parts', () => {
  const xlsx = buildOptimizedSupplierOrderXlsx(optimizationFixture());
  assert.equal(xlsx[0], 0x50);
  assert.equal(xlsx[1], 0x4b);

  const archive = unzip(xlsx);
  for (const name of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
    'xl/styles.xml',
  ]) {
    assert.ok(archive[name], `Missing ${name}`);
  }
});

test('supplier workbook keeps its Cyrillic sheet name and values', () => {
  const archive = unzip(
    buildOptimizedSupplierOrderXlsx(optimizationFixture())
  );
  const workbook = xmlFile(archive, 'xl/workbook.xml');
  const sheet = xmlFile(archive, 'xl/worksheets/sheet1.xml');

  assert.match(workbook, new RegExp(`name="${SUPPLIER_SHEET_NAME}"`));
  assert.match(sheet, /Артикул/);
  assert.match(sheet, /Корм &lt;Особый&gt; для собак/);
  assert.match(sheet, /АРТ&amp;1/);
});

test('supplier workbook contains only positive optimized quantities', () => {
  const sheet = xmlFile(
    unzip(buildOptimizedSupplierOrderXlsx(optimizationFixture())),
    'xl/worksheets/sheet1.xml'
  );

  assert.doesNotMatch(sheet, /ZERO|Не включать/);
  assert.match(sheet, /<c r="C2" s="0"><v>2<\/v><\/c>/);
  assert.match(sheet, /<c r="C3" s="0"><v>1<\/v><\/c>/);
});

test('money is numeric and total equals optimizedTotal', () => {
  const archive = unzip(
    buildOptimizedSupplierOrderXlsx(optimizationFixture())
  );
  const sheet = xmlFile(archive, 'xl/worksheets/sheet1.xml');
  const styles = xmlFile(archive, 'xl/styles.xml');

  assert.match(sheet, /<c r="D2" s="2"><v>10\.25<\/v><\/c>/);
  assert.match(sheet, /<c r="E2" s="2"><v>20\.5<\/v><\/c>/);
  assert.match(sheet, /<c r="E4" s="4"><v>45\.67<\/v><\/c>/);
  assert.doesNotMatch(sheet, /r="(?:C2|D2|E2)"[^>]*t="inlineStr"/);
  assert.match(styles, /numFmtId="164"/);
  assert.match(styles, /formatCode="#,##0\.00 &quot;₽&quot;"/);
  assert.match(
    styles,
    /<font><b\/><sz val="11"\/><color rgb="FF102515"\/>/
  );
  assert.match(styles, /numFmtId="164" fontId="2"[^>]*applyFont="1"/);
});

test('workbook applies header, filter, freeze and column widths', () => {
  const sheet = xmlFile(
    unzip(buildOptimizedSupplierOrderXlsx(optimizationFixture())),
    'xl/worksheets/sheet1.xml'
  );

  assert.match(sheet, /<row r="1"[^>]*>[\s\S]*?<c r="A1" s="1"/);
  assert.match(sheet, /<pane ySplit="1"[^>]*state="frozen"\/>/);
  assert.match(sheet, /<autoFilter ref="A1:E3"\/>/);
  assert.match(sheet, /<col min="2" max="2" width="55"/);
  assert.match(sheet, /<c r="B4" s="3"[\s\S]*?>ИТОГО</);
});

test('supplier workbook excludes internal AI fields and decisions', () => {
  const sheet = xmlFile(
    unzip(buildOptimizedSupplierOrderXlsx(optimizationFixture())),
    'xl/worksheets/sheet1.xml'
  );

  assert.doesNotMatch(
    sheet,
    /manual_review|must_buy|recommended|postpone|privateTechnicalField/
  );
});

test('removed workbook contains every removed item and no AI decision', () => {
  const archive = unzip(
    buildOptimizedRemovedItemsXlsx(optimizationFixture())
  );
  const workbook = xmlFile(archive, 'xl/workbook.xml');
  const sheet = xmlFile(archive, 'xl/worksheets/sheet1.xml');

  assert.match(workbook, new RegExp(`name="${REMOVED_SHEET_NAME}"`));
  assert.match(sheet, /REM-1/);
  assert.match(sheet, /REM-2/);
  assert.equal(
    (sheet.match(/Исключено при оптимизации бюджета/g) || []).length,
    2
  );
  assert.doesNotMatch(sheet, /manual_review|postpone/);
});

test('file descriptors use required names and XLSX content type', () => {
  const files = createOptimizedXlsxFiles(optimizationFixture());

  assert.equal(files.supplierOrder.name, SUPPLIER_ORDER_FILE_NAME);
  assert.equal(files.removedItems.name, REMOVED_ITEMS_FILE_NAME);
  assert.equal(files.supplierOrder.type, XLSX_CONTENT_TYPE);
  assert.equal(files.removedItems.type, XLSX_CONTENT_TYPE);
});

test('XLSX export does not mutate optimization result', () => {
  const result = optimizationFixture();
  const before = structuredClone(result);

  createOptimizedXlsxFiles(result);

  assert.deepEqual(result, before);
});

test('XLSX export rejects a non-successful optimization status', () => {
  const result = optimizationFixture();
  result.status = 'BUDGET_TOO_LOW';

  assert.throws(
    () => createOptimizedXlsxFiles(result),
    /OPTIMIZED or UNCHANGED/
  );
});
