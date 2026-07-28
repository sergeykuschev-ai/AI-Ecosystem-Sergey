'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  REMOVED_ITEMS_FILE_NAME,
  SUPPLIER_ORDER_FILE_NAME,
  UTF8_BOM,
  buildOptimizedRemovedItemsCsv,
  buildOptimizedSupplierOrderCsv,
  createOptimizedCsvFiles,
} = require('../../../shared/reporting/csv_exporter');

function optimizationFixture() {
  return {
    targetBudget: 50,
    originalTotal: 85.67,
    optimizedTotal: 45.67,
    removedAmount: 40,
    status: 'OPTIMIZED',
    items: [
      {
        sku: 'SKU;1',
        name: 'Корм "Особый"\nдля собак',
        decision: 'manual_review',
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
        sku: 'REM;1',
        name: 'Исключённый "товар"',
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

test('both optimized CSV files start with UTF-8 BOM', () => {
  const result = optimizationFixture();
  assert.ok(buildOptimizedSupplierOrderCsv(result).startsWith(UTF8_BOM));
  assert.ok(buildOptimizedRemovedItemsCsv(result).startsWith(UTF8_BOM));
});

test('supplier CSV uses semicolon columns and decimal commas', () => {
  const csv = buildOptimizedSupplierOrderCsv(optimizationFixture());
  assert.match(
    csv,
    /Артикул;Наименование;Количество;Цена, ₽;Сумма, ₽;/
  );
  assert.match(csv, /;2;10,25;20,50;manual_review;/);
  assert.doesNotMatch(csv, /10\.25|20\.50/);
});

test('quotes, semicolons and line breaks are escaped as Excel CSV', () => {
  const csv = buildOptimizedSupplierOrderCsv(optimizationFixture());
  assert.match(
    csv,
    /"SKU;1";"Корм ""Особый""\nдля собак";2;10,25;20,50;/
  );
});

test('supplier CSV excludes zero quantity and labels changes', () => {
  const csv = buildOptimizedSupplierOrderCsv(optimizationFixture());
  assert.doesNotMatch(csv, /ZERO|Не включать/);
  assert.match(csv, /Количество уменьшено/);
  assert.match(csv, /Без изменений/);
});

test('supplier total row uses optimizedTotal in the amount column', () => {
  const csv = buildOptimizedSupplierOrderCsv(optimizationFixture());
  assert.match(csv, /\r\nИТОГО;;;;45,67;;\r\n$/);
});

test('removed items CSV contains every removed item', () => {
  const csv = buildOptimizedRemovedItemsCsv(optimizationFixture());
  assert.match(csv, /"REM;1";"Исключённый ""товар""";2;2;30,00;/);
  assert.match(csv, /REM-2;Исключённый товар 2;1;1;10,00;/);
  assert.equal(
    (csv.match(/Исключено при оптимизации бюджета/g) || []).length,
    2
  );
});

test('file descriptors use the required names and content type', () => {
  const files = createOptimizedCsvFiles(optimizationFixture());
  assert.equal(files.supplierOrder.name, SUPPLIER_ORDER_FILE_NAME);
  assert.equal(files.removedItems.name, REMOVED_ITEMS_FILE_NAME);
  assert.equal(files.supplierOrder.type, 'text/csv;charset=utf-8');
  assert.equal(files.removedItems.type, 'text/csv;charset=utf-8');
});

test('CSV export does not mutate the optimization result', () => {
  const result = optimizationFixture();
  const before = structuredClone(result);
  createOptimizedCsvFiles(result);
  assert.deepEqual(result, before);
});

test('CSV export rejects non-successful optimization status', () => {
  const result = optimizationFixture();
  result.status = 'BUDGET_TOO_LOW';
  assert.throws(
    () => createOptimizedCsvFiles(result),
    /OPTIMIZED or UNCHANGED/
  );
});
