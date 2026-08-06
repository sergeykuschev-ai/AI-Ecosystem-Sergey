'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { strFromU8, unzipSync } = require('fflate');

const {
  MANDATORY_HEADERS,
  SUPPLIER_ORDER_BLOCKED_CODE,
  SUPPLIER_ORDER_BLOCKED_MESSAGE,
  SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
  SUPPLIER_ORDER_EMPTY_CODE,
  SUPPLIER_ORDER_SHEET_NAME,
  SupplierOrderError,
  buildSupplierOrder,
  buildSupplierOrderFilename,
  buildSupplierOrderXlsx,
  finalOrderQuantity,
  sanitizeSupplierName,
} = require('../services/supplier_order');

const GENERATED_AT = '2026-07-31T12:00:00.000Z';

function item(overrides = {}) {
  return {
    row_id: 'row-1',
    sku: 'ART-1',
    barcode: '4600000000001',
    name: 'Корм для кошек',
    brand: 'Миска',
    supplier: 'Оникиенко',
    workflow_status: 'auto_approved',
    quantities: { approved_quantity: 3 },
    amounts: { unit_price: 10.5 },
    matrix: { owner_review_required: false },
    owner_decision: { decision: null, quantity: null },
    ...overrides,
  };
}

function sheetXml(xlsx) {
  const files = unzipSync(xlsx);
  assert.ok(files['xl/worksheets/sheet1.xml'], 'лист xlsx отсутствует');
  return {
    files,
    sheet: strFromU8(files['xl/worksheets/sheet1.xml']),
    workbook: strFromU8(files['xl/workbook.xml']),
  };
}

test('OWNER BUY сохраняет исходное количество в заказе поставщику', () => {
  const order = buildSupplierOrder({
    items: [
      item({
        row_id: 'owner-buy',
        sku: 'BUY-1',
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null },
        matrix: { owner_review_required: true },
        owner_decision: { decision: 'BUY', quantity: 7 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
  assert.equal(order.rows[0].article, 'BUY-1');
  assert.equal(order.rows[0].quantity, 7);
  assert.equal(order.rows[0].amount, 73.5);

  const xlsx = buildSupplierOrderXlsx(order);
  const { sheet } = sheetXml(xlsx);
  assert.ok(sheet.includes('>BUY-1<'));
  assert.ok(sheet.includes('<v>7</v>') || sheet.includes('<v>7.0</v>'));
});

test('1. в заказ попадают только утверждённые позиции: BUY и auto_approved', () => {
  const order = buildSupplierOrder({
    items: [
      item({ row_id: 'auto', sku: 'AUTO-1' }),
      item({
        row_id: 'buy',
        sku: 'BUY-1',
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null },
        matrix: { owner_review_required: true },
        owner_decision: { decision: 'BUY', quantity: 7 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 2);
  assert.deepEqual(
    order.rows.map(row => row.article),
    ['AUTO-1', 'BUY-1']
  );
  assert.equal(order.rows[0].quantity, 3);
  assert.equal(order.rows[1].quantity, 7);
});

test('2. отклонённые позиции (SKIP) отсутствуют в заказе', () => {
  const order = buildSupplierOrder({
    items: [
      item({ row_id: 'auto' }),
      item({
        row_id: 'skip',
        sku: 'SKIP-1',
        owner_decision: { decision: 'SKIP', quantity: 0 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
  assert.equal(order.rows[0].article, 'ART-1');
});

test('3. pending- и unresolved-позиции с решением отсутствуют в заказе', () => {
  const order = buildSupplierOrder({
    items: [
      item({ row_id: 'auto' }),
      item({
        row_id: 'pending-skip',
        sku: 'PEND-1',
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null, provisional_quantity: 5 },
        owner_decision: { decision: 'SKIP', quantity: 0 },
      }),
      item({
        row_id: 'deferred',
        sku: 'DEF-1',
        workflow_status: 'pending_manual_review',
        owner_decision: { decision: 'DEFER', quantity: null },
      }),
      item({
        row_id: 'no-order',
        sku: 'NOO-1',
        workflow_status: 'no_order_action',
        quantities: { approved_quantity: null },
      }),
      item({
        row_id: 'unresolved-data',
        sku: 'UNR-1',
        workflow_status: null,
        quantities: { approved_quantity: null },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
  assert.equal(order.rows[0].row_id, undefined);
  assert.equal(order.rows[0].article, 'ART-1');
});

test('4. при незавершённой ручной проверке экспорт блокируется', () => {
  assert.throws(
    () => buildSupplierOrder({
      items: [
        item({ row_id: 'auto' }),
        item({
          row_id: 'undecided',
          matrix: { owner_review_required: true },
          workflow_status: 'pending_manual_review',
          quantities: { approved_quantity: null },
        }),
      ],
      supplier: 'Оникиенко',
      generatedAt: GENERATED_AT,
    }),
    error => {
      assert.ok(error instanceof SupplierOrderError);
      assert.equal(error.code, SUPPLIER_ORDER_BLOCKED_CODE);
      assert.equal(error.message, SUPPLIER_ORDER_BLOCKED_MESSAGE);
      assert.equal(
        error.message,
        'Завершите ручную проверку всех позиций перед формированием ' +
        'заказа поставщику'
      );
      assert.equal(error.details.pending_count, 1);
      return true;
    }
  );
  // pending_manual_review без owner_review_required не блокирует экспорт:
  // единственный источник истины о завершении проверки — флаг
  // owner_review_required, статус workflow сам по себе заказ не держит.
  const order = buildSupplierOrder({
    items: [
      item({ row_id: 'auto' }),
      item({
        row_id: 'pending',
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
});

test('4a. DEFER — принятое решение: исключается, но не блокирует', () => {
  const order = buildSupplierOrder({
    items: [
      item({ row_id: 'auto' }),
      item({
        row_id: 'deferred',
        matrix: { owner_review_required: true },
        owner_decision: { decision: 'DEFER', quantity: null },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
});

test('5. сумма строки равна количество × цена', () => {
  const order = buildSupplierOrder({
    items: [
      item({
        quantities: { approved_quantity: 7 },
        amounts: { unit_price: 33.33 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.rows[0].amount, 233.31);
});

test('6. общая сумма равна сумме строк', () => {
  const order = buildSupplierOrder({
    items: [
      item({
        row_id: 'a',
        quantities: { approved_quantity: 3 },
        amounts: { unit_price: 10.05 },
      }),
      item({
        row_id: 'b',
        sku: 'B-1',
        quantities: { approved_quantity: 2 },
        amounts: { unit_price: 99.99 },
      }),
      item({
        row_id: 'c',
        sku: 'C-1',
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null },
        matrix: { owner_review_required: true },
        owner_decision: { decision: 'BUY', quantity: 1 },
        amounts: { unit_price: 0.01 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  const rowSum = order.rows.reduce((sum, row) => sum + row.amount, 0);
  assert.equal(order.totalAmount, Math.round(rowSum * 100) / 100);
  assert.equal(order.totalAmount, 230.14);
});

test('7. позиции с нулевым и отрицательным количеством исключаются', () => {
  assert.equal(finalOrderQuantity(item({
    quantities: { approved_quantity: 0 },
  })), null);
  assert.equal(finalOrderQuantity(item({
    quantities: { approved_quantity: -2 },
  })), null);
  assert.equal(finalOrderQuantity(item({
    owner_decision: { decision: 'BUY', quantity: 0 },
    quantities: { approved_quantity: null },
  })), null);
  const order = buildSupplierOrder({
    items: [
      item({ row_id: 'zero', quantities: { approved_quantity: 0 } }),
      item({ row_id: 'ok' }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
});

test('8. ведущие нули в артикулах и штрихкодах сохраняются', () => {
  const order = buildSupplierOrder({
    items: [
      item({
        sku: '00123',
        barcode: '0046000000001',
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  const xlsx = buildSupplierOrderXlsx(order);
  const { sheet } = sheetXml(xlsx);
  assert.ok(sheet.includes('>00123<'), 'артикул потерял ведущие нули');
  assert.ok(
    sheet.includes('>0046000000001<'),
    'штрихкод потерял ведущие нули'
  );
  assert.ok(order.headers.includes('Штрихкод'));
});

test('9. пустой заказ не создаёт фиктивный Excel', () => {
  assert.throws(
    () => buildSupplierOrder({
      items: [
        item({
          row_id: 'skip',
          owner_decision: { decision: 'SKIP', quantity: 0 },
        }),
      ],
      supplier: 'Оникиенко',
      generatedAt: GENERATED_AT,
    }),
    error => {
      assert.ok(error instanceof SupplierOrderError);
      assert.equal(error.code, SUPPLIER_ORDER_EMPTY_CODE);
      return true;
    }
  );
  assert.throws(
    () => buildSupplierOrder({
      items: [],
      supplier: 'Оникиенко',
      generatedAt: GENERATED_AT,
    }),
    error => error.code === SUPPLIER_ORDER_EMPTY_CODE
  );
});

test('10. формируется валидный .xlsx с листом «Заказ поставщику» и ИТОГО', () => {
  const order = buildSupplierOrder({
    items: [
      item({ quantities: { approved_quantity: 2 } }),
      item({
        row_id: 'b',
        sku: 'B-2',
        barcode: null,
        quantities: { approved_quantity: 1 },
        amounts: { unit_price: 5 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  const xlsx = buildSupplierOrderXlsx(order);
  assert.ok(Buffer.from(xlsx.slice(0, 2)).equals(Buffer.from('PK')));
  const { files, sheet, workbook } = sheetXml(xlsx);
  for (const part of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/styles.xml',
  ]) {
    assert.ok(files[part], `в xlsx отсутствует ${part}`);
  }
  assert.ok(workbook.includes(`name="${SUPPLIER_ORDER_SHEET_NAME}"`));
  for (const header of MANDATORY_HEADERS) {
    assert.ok(sheet.includes(`>${header}<`), `нет колонки ${header}`);
  }
  assert.ok(sheet.includes('>ИТОГО<'));
  assert.ok(sheet.includes('<v>26</v>') || sheet.includes('<v>26.0</v>'));
});

test('имя файла соответствует формату Заказ_поставщику_<поставщик>_<дата>.xlsx', () => {
  assert.equal(
    buildSupplierOrderFilename('Оникиенко', GENERATED_AT),
    'Заказ_поставщику_Оникиенко_31.07.2026.xlsx'
  );
  assert.equal(
    buildSupplierOrderFilename('ИП «Оникиенко А.В.» / розница', GENERATED_AT),
    'Заказ_поставщику_ИП_«Оникиенко_А.В.»_розница_31.07.2026.xlsx'
  );
  assert.equal(
    buildSupplierOrderFilename(null, GENERATED_AT),
    'Заказ_поставщику_поставщик_31.07.2026.xlsx'
  );
  assert.equal(sanitizeSupplierName('   '), 'поставщик');
});

test('опциональные колонки добавляются только при наличии данных', () => {
  const withoutOptional = buildSupplierOrder({
    items: [item({ barcode: null, brand: null })],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(withoutOptional.headers, [...MANDATORY_HEADERS]);

  const withBrandOnly = buildSupplierOrder({
    items: [item({ barcode: null })],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(withBrandOnly.headers, [...MANDATORY_HEADERS, 'Бренд']);
});

test('утверждённая позиция без закупочной цены блокирует формирование', () => {
  assert.throws(
    () => buildSupplierOrder({
      items: [item({ amounts: { unit_price: null } })],
      supplier: 'Оникиенко',
      generatedAt: GENERATED_AT,
    }),
    error => error.code === SUPPLIER_ORDER_DATA_INCOMPLETE_CODE
  );
});

test('ручное количество владельца заменяет автоматическое', () => {
  const order = buildSupplierOrder({
    items: [
      item({
        quantities: { approved_quantity: 10 },
        owner_decision: { decision: 'BUY', quantity: 4 },
      }),
    ],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.rows[0].quantity, 4);
  assert.equal(order.rows[0].amount, 42);
});

test('пустой артикул не ломает экспорт: позиция выгружается с пустой ячейкой', () => {
  const order = buildSupplierOrder({
    items: [item({ sku: null, barcode: '' })],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  assert.equal(order.itemCount, 1);
  assert.equal(order.rows[0].article, '');
  const xlsx = buildSupplierOrderXlsx(order);
  const { sheet } = sheetXml(xlsx);
  assert.ok(sheet.includes('Корм для кошек'));
});

test('штрихкод с ведущим нулём сохраняется как текст', () => {
  const order = buildSupplierOrder({
    items: [item({ barcode: '0460000000001' })],
    supplier: 'Оникиенко',
    generatedAt: GENERATED_AT,
  });
  const xlsx = buildSupplierOrderXlsx(order);
  const { sheet } = sheetXml(xlsx);
  assert.ok(sheet.includes('0460000000001'));
  assert.ok(sheet.includes('inlineStr'), 'штрихкод записан как текст');
});
