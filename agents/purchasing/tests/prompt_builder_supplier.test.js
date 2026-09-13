'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMinmaxText, supplierReportContext } = require('../services/prompt_builder');

function analysisFor(supplier, totalOrderSum = 1000) {
  const row = {
    rowNumber: 1,
    name: 'Тестовый товар',
    article: 'SKU-1',
    supplier,
    orderQty: 1,
    priceNum: totalOrderSum,
    sumNum: totalOrderSum,
  };
  return {
    productRows: [row],
    orderRows: [row],
    zeroStockRows: [],
    riskyRows: [],
    expensiveRows: [row],
    totalOrderSum,
    missingToFreeDelivery: Math.max(0, 70000 - totalOrderSum),
  };
}

test('Valta report uses Valta heading and free-delivery threshold text', () => {
  const analysis = analysisFor('АО "ВАЛТА ПЕТ ПРОДАКТС"');
  assert.deepEqual(supplierReportContext(analysis.productRows), {
    group: 'валта', heading: 'ВАЛТЫ', deliveryThreshold: 70000,
  });
  const text = buildMinmaxText([], analysis, { sourceRowsCount: 1 });
  assert.match(text, /^# ДАННЫЕ ИЗ ОТЧЁТА MIN-MAX ВАЛТЫ/m);
  assert.match(text, /До бесплатной доставки Валты не хватает:/);
});

test('Zoograd report uses Zoograd heading and never mentions Valta delivery', () => {
  const analysis = analysisFor('Оникиенко Роман Евгеньевич');
  assert.deepEqual(supplierReportContext(analysis.productRows), {
    group: 'зооград', heading: 'ЗООГРАДА', deliveryThreshold: null,
  });
  const text = buildMinmaxText([], analysis, { sourceRowsCount: 1 });
  assert.match(text, /^# ДАННЫЕ ИЗ ОТЧЁТА MIN-MAX ЗООГРАДА/m);
  assert.doesNotMatch(text, /бесплатной доставки Валты/);
});
