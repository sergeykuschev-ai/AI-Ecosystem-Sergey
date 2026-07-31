'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  positionsLabel,
  supplierOrderCardModel,
  supplierOrderEndpoints,
} = require('../public/app');

const RUN_ID = '55555555-5555-4555-8555-555555555555';
const appSource = fs.readFileSync(
  path.resolve(__dirname, '../public/app.js'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.resolve(__dirname, '../public/styles.css'),
  'utf8'
);

function availableMetadata(overrides = {}) {
  return {
    available: true,
    filename: 'Заказ_поставщику_Оникиенко_31.07.2026.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.' +
      'spreadsheetml.sheet',
    downloadUrl: `/api/v1/runs/${RUN_ID}/supplier-order/download`,
    itemCount: 354,
    totalAmount: 107483.43,
    blockedReason: null,
    ...overrides,
  };
}

test('endpoints строятся только для валидного run id', () => {
  assert.deepEqual(supplierOrderEndpoints(RUN_ID), {
    metadata: `/api/v1/runs/${RUN_ID}/supplier-order`,
    download: `/api/v1/runs/${RUN_ID}/supplier-order/download`,
  });
  assert.equal(supplierOrderEndpoints('../etc/passwd'), null);
  assert.equal(supplierOrderEndpoints('not-a-uuid'), null);
  assert.equal(supplierOrderEndpoints(null), null);
});

test('карточка появляется только при готовом файле', () => {
  const endpoints = supplierOrderEndpoints(RUN_ID);
  const model = supplierOrderCardModel(availableMetadata(), endpoints);
  assert.ok(model);
  assert.equal(model.title, 'Заказ поставщику');
  assert.equal(
    model.description,
    'Готовый Excel-файл с окончательно утверждёнными позициями ' +
    'для отправки поставщику'
  );
  assert.equal(model.meta, '354 позиции · 107\u00A0483,43\u00A0₽');
  assert.equal(
    model.filename,
    'Заказ_поставщику_Оникиенко_31.07.2026.xlsx'
  );
  assert.equal(model.downloadUrl, endpoints.download);
});

test('карточка скрыта, пока проверка не завершена или файл не создан', () => {
  const endpoints = supplierOrderEndpoints(RUN_ID);
  const blocked = availableMetadata({
    available: false,
    filename: null,
    downloadUrl: null,
    itemCount: 0,
    totalAmount: null,
    blockedReason:
      'Завершите ручную проверку всех позиций перед формированием ' +
      'заказа поставщику',
  });
  assert.equal(supplierOrderCardModel(blocked, endpoints), null);
  assert.equal(supplierOrderCardModel(null, endpoints), null);
  assert.equal(
    supplierOrderCardModel(
      availableMetadata({ downloadUrl: '/api/v1/runs/other/download' }),
      endpoints
    ),
    null
  );
  assert.equal(
    supplierOrderCardModel(availableMetadata({ itemCount: 0 }), endpoints),
    null
  );
  assert.equal(
    supplierOrderCardModel(
      availableMetadata({ totalAmount: '107483.43' }),
      endpoints
    ),
    null
  );
  assert.equal(
    supplierOrderCardModel(availableMetadata(), null),
    null
  );
});

test('склонение слова «позиция»', () => {
  assert.equal(positionsLabel(1), 'позиция');
  assert.equal(positionsLabel(2), 'позиции');
  assert.equal(positionsLabel(4), 'позиции');
  assert.equal(positionsLabel(5), 'позиций');
  assert.equal(positionsLabel(11), 'позиций');
  assert.equal(positionsLabel(21), 'позиция');
  assert.equal(positionsLabel(111), 'позиций');
  assert.equal(positionsLabel(354), 'позиции');
});

test('карточка подключена к блоку «Отчёты» и обновляется после решений', () => {
  assert.ok(
    appSource.includes('refreshSupplierOrderCard();'),
    'обновление карточки не подключено'
  );
  const saveHandler = appSource.indexOf('onSaved(result, savedItem)');
  const refreshAfterSave = appSource.indexOf(
    'refreshSupplierOrderCard();',
    saveHandler
  );
  assert.ok(saveHandler > 0 && refreshAfterSave > saveHandler);
  const completed = appSource.indexOf('configureDownloads(manifest);');
  assert.ok(
    appSource.indexOf('refreshSupplierOrderCard();', completed) > completed
  );
  assert.ok(cssSource.includes('.report-card-meta'));
});
