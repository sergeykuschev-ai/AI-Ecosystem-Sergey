'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  decodeEntities,
  parseMinMaxWorkbook,
  matchesForModule,
  trainingModulePriority,
  applyMinMaxToTrainingTask,
} = require('../application/seller_minmax_catalog');

function workbook(rows) {
  return [{
    sheet: 'Лист_1',
    data: [
      ['header-1'],
      ['header-2'],
      ['header-3'],
      ...rows,
    ],
  }];
}

function product(name, options = {}) {
  const row = new Array(53).fill(null);
  row[1] = options.article || null;
  row[2] = name;
  row[3] = options.supplier || 'Поставщик';
  row[4] = options.abc || 'C';
  row[6] = options.xyz || 'Y';
  row[7] = options.price ?? 100;
  row[35] = options.sales ?? 1;
  row[42] = options.stockDays ?? 5;
  row[43] = options.freeStock ?? 1;
  row[48] = options.autoMin ?? 1;
  row[49] = options.manualMin ?? null;
  row[51] = options.orderQty ?? 0;
  return row;
}

test('Min/Max parser keeps only product rows and decodes names', () => {
  const parsed = parseMinMaxWorkbook(workbook([
    product('Растительный наполнитель Cat&apos;s choice 6 л', {
      article: 'CC-1',
      freeStock: 4,
    }),
    ['category', null, 'Кошки (20)', null],
    product('Сухой корм AWARD Sterilized 1,5 кг', { article: 'AW-1' }),
  ]));

  assert.equal(parsed.totalItems, 2);
  assert.equal(parsed.items[0].name, "Растительный наполнитель Cat's choice 6 л");
  assert.equal(parsed.items[0].article, 'CC-1');
  assert.equal(parsed.items[0].freeStock, 4);
  assert.equal(decodeEntities('A &amp; B &quot;X&quot;'), 'A & B "X"');
});

test('Min/Max module matcher uses actual assortment and prioritizes in-stock ABC items', () => {
  const parsed = parseMinMaxWorkbook(workbook([
    product('Сухой корм AWARD Sterilized C', { abc: 'C', freeStock: 5, sales: 10 }),
    product('Сухой корм AWARD Sterilized A', { abc: 'A', freeStock: 2, sales: 5 }),
    product('Сухой корм AWARD Sterilized zero', { abc: 'A', freeStock: 0, sales: 50 }),
    product('Сухой корм AWARD Monoprotein для взрослых собак', { abc: 'A' }),
    product('Сухой корм AWARD Monoprotein для взрослых кошек', { abc: 'B' }),
  ]));

  const sterilized = matchesForModule(parsed, 'KNOW-01', 3);
  assert.deepEqual(
    sterilized.map(item => item.name),
    [
      'Сухой корм AWARD Sterilized A',
      'Сухой корм AWARD Sterilized C',
      'Сухой корм AWARD Sterilized zero',
    ]
  );

  const mono = matchesForModule(parsed, 'KNOW-02', 5);
  assert.deepEqual(mono.map(item => item.name), [
    'Сухой корм AWARD Monoprotein для взрослых кошек',
  ]);
});

test('Min/Max replaces static SKU examples and removes absent assortment examples', () => {
  const parsed = parseMinMaxWorkbook(workbook([
    product('Корм Bambini Pets для хомяков 400 г', { abc: 'A', freeStock: 3 }),
  ]));
  parsed.fileUpdatedAt = '2026-09-22T00:00:00.000Z';

  const bambini = applyMinMaxToTrainingTask({
    code: 'KNOW-23',
    taskType: 'KNOWLEDGE',
    productExamples: ['Старый ручной пример'],
  }, parsed);
  assert.deepEqual(bambini.productExamples, [
    'Корм Bambini Pets для хомяков 400 г',
  ]);
  assert.equal(bambini.minMax.source, 'MINMAX');
  assert.equal(bambini.minMax.totalCatalogItems, 1);

  const inspector = applyMinMaxToTrainingTask({
    code: 'KNOW-09',
    taskType: 'KNOWLEDGE',
    productExamples: ['Inspector Mini'],
  }, parsed);
  assert.deepEqual(inspector.productExamples, []);
  assert.equal(inspector.minMax.matchedItems, 0);
});

test('current MISKA Min/Max matcher recognizes core brand assortment shapes', () => {
  const parsed = parseMinMaxWorkbook(workbook([
    product('Влажный корм Мнямс с кроликом 85 г'),
    product('Растительный комкующийся наполнитель тофу Cat&apos;s choice 6 л/2,5 кг'),
    product('Сухой корм CRAFTIA HARMONA для стерилизованных кошек 1,4 кг'),
    product('Игрушка Bambini Pets для грызунов из люфы'),
    product('Влажный корм Ферма кота Фёдора для котят 85 г'),
  ]));

  assert.equal(matchesForModule(parsed, 'KNOW-06').length, 1);
  assert.equal(matchesForModule(parsed, 'KNOW-08').length, 1);
  assert.equal(matchesForModule(parsed, 'KNOW-22').length, 1);
  assert.equal(matchesForModule(parsed, 'KNOW-23').length, 1);
  assert.equal(matchesForModule(parsed, 'KNOW-24').length, 1);
});

test('training module priority favors current in-stock ABC and incoming assortment', () => {
  const parsed = parseMinMaxWorkbook(workbook([
    product('Влажный корм Мнямс A 85 г', {
      abc: 'A', freeStock: 10, sales: 20, orderQty: 5,
    }),
    product('Влажный корм Мнямс B 85 г', {
      abc: 'B', freeStock: 5, sales: 10,
    }),
    product('Сухой корм CRAFTIA HARMONA 1,4 кг', {
      abc: 'C', freeStock: 1, sales: 2,
    }),
    product('Inspector Mini', {
      abc: 'A', freeStock: 0, sales: 50, orderQty: 0,
    }),
  ]));
  const priority = trainingModulePriority(parsed);
  assert.deepEqual(priority.map(item => item.moduleCode), [
    'KNOW-06', 'KNOW-22', 'KNOW-09',
  ]);
  assert.equal(priority[0].inStockItems, 2);
  assert.equal(priority[0].highPriorityItems, 2);
  assert.equal(priority[0].incomingItems, 1);
});
