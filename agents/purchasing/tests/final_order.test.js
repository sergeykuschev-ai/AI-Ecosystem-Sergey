'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  buildFinalOrderState,
  classifyItem,
  roundMoney,
} = require('../services/final_order');

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

test('BUY с ручным количеством > 0 включается как manual', () => {
  const state = buildFinalOrderState({
    items: [
      item({
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null },
        matrix: { owner_review_required: true },
        owner_decision: { decision: 'BUY', quantity: 7 },
      }),
    ],
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.reviewComplete, true);
  assert.equal(state.itemCount, 1);
  assert.equal(state.includedItems[0].source, 'manual');
  assert.equal(state.includedItems[0].quantity, 7);
  assert.equal(state.includedItems[0].amount, 73.5);
  assert.equal(state.manuallyApprovedAmount, 73.5);
  assert.equal(state.autoApprovedAmount, 0);
});

test('SKIP исключается и учитывается в skippedAmount', () => {
  const state = buildFinalOrderState({
    items: [
      item({ owner_decision: { decision: 'SKIP', quantity: 0 } }),
    ],
  });
  assert.equal(state.itemCount, 0);
  assert.equal(state.excludedItems[0].reason, 'skipped');
  assert.equal(state.skippedAmount, 31.5);
  assert.equal(state.status, 'empty');
  assert.equal(state.reviewComplete, true);
});

test('DEFER исключается из текущего заказа, проверка завершена', () => {
  const state = buildFinalOrderState({
    items: [
      item({
        matrix: { owner_review_required: true },
        owner_decision: { decision: 'DEFER', quantity: null },
      }),
    ],
  });
  assert.equal(state.reviewComplete, true);
  assert.equal(state.unresolvedCount, 0);
  assert.equal(state.excludedItems[0].reason, 'deferred');
  assert.equal(state.deferredAmount, 31.5);
});

test('auto_approved с количеством > 0 включается как auto', () => {
  const state = buildFinalOrderState({ items: [item()] });
  assert.equal(state.includedItems[0].source, 'auto');
  assert.equal(state.autoApprovedAmount, 31.5);
  assert.equal(state.manuallyApprovedAmount, 0);
});

test('unresolved и pending без решения блокируют финальный заказ', () => {
  const reviewRequired = buildFinalOrderState({
    items: [
      item({
        matrix: { owner_review_required: true },
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null },
      }),
    ],
  });
  assert.equal(reviewRequired.status, 'review_incomplete');
  assert.equal(reviewRequired.reviewComplete, false);
  assert.equal(reviewRequired.unresolvedCount, 1);

  const pending = buildFinalOrderState({
    items: [
      item({
        workflow_status: 'pending_manual_review',
        quantities: { approved_quantity: null, provisional_quantity: 2 },
      }),
    ],
  });
  assert.equal(pending.status, 'review_incomplete');
  assert.equal(pending.unresolvedCount, 1);
  assert.equal(pending.unresolvedAmount, 21);
});

test('нулевое и отрицательное количество исключается', () => {
  for (const quantity of [0, -3]) {
    const classification = classifyItem(item({
      quantities: { approved_quantity: quantity },
    }));
    assert.equal(classification.kind, 'excluded');
  }
  const buyZero = classifyItem(item({
    owner_decision: { decision: 'BUY', quantity: 0 },
    quantities: { approved_quantity: null },
  }));
  assert.equal(buyZero.kind, 'excluded');
  assert.equal(buyZero.reason, 'zero_quantity');
});

test('ручное количество имеет приоритет над approved_quantity', () => {
  const state = buildFinalOrderState({
    items: [
      item({
        quantities: { approved_quantity: 10 },
        owner_decision: { decision: 'BUY', quantity: 4 },
      }),
    ],
  });
  assert.equal(state.includedItems[0].quantity, 4);
  assert.equal(state.totalAmount, 42);
});

test('дубли SKU — отдельные позиции, обе учитываются', () => {
  const state = buildFinalOrderState({
    items: [
      item({ row_id: 'row-a', quantities: { approved_quantity: 2 } }),
      item({ row_id: 'row-b', quantities: { approved_quantity: 5 } }),
    ],
  });
  assert.equal(state.itemCount, 2);
  assert.equal(state.totalAmount, 73.5);
  assert.deepEqual(state.duplicateIncludedSkus, ['ART-1']);
});

test('одинаковый SKU у разных поставщиков не смешивается', () => {
  const state = buildFinalOrderState({
    items: [
      item({ row_id: 'a', supplier: 'Поставщик А' }),
      item({ row_id: 'b', supplier: 'Поставщик Б' }),
    ],
  });
  assert.equal(state.itemCount, 2);
  assert.deepEqual(
    state.includedItems.map(entry => entry.supplier),
    ['Поставщик А', 'Поставщик Б']
  );
});

test('округление едино: итог = сумма округлённых строк', () => {
  const state = buildFinalOrderState({
    items: [
      item({
        row_id: 'a',
        quantities: { approved_quantity: 3 },
        amounts: { unit_price: 0.335 },
      }),
      item({
        row_id: 'b',
        sku: 'B-1',
        quantities: { approved_quantity: 7 },
        amounts: { unit_price: 0.145 },
      }),
    ],
  });
  assert.equal(state.includedItems[0].amount, 1.01);
  assert.equal(state.includedItems[1].amount, 1.02);
  assert.equal(state.totalAmount, 2.03);
  assert.equal(
    state.totalAmount,
    roundMoney(state.includedItems[0].amount +
      state.includedItems[1].amount)
  );
});

test('remainingBudget = безопасный бюджет минус итог заказа', () => {
  const state = buildFinalOrderState({
    items: [item()],
    maximumSafeOrderAmount: 100,
  });
  assert.equal(state.remainingBudget, 68.5);
  const withoutBudget = buildFinalOrderState({ items: [item()] });
  assert.equal(withoutBudget.remainingBudget, null);
});

test('включённая позиция без цены видна явно, а не как 0', () => {
  const state = buildFinalOrderState({
    items: [item({ amounts: { unit_price: null } })],
  });
  assert.equal(state.includedItems[0].price, null);
  assert.equal(state.includedItems[0].amount, null);
  assert.equal(state.missingPriceIncludedCount, 1);
  assert.equal(state.totalAmount, 0);
});

test('статус empty для заказа без включённых позиций', () => {
  const state = buildFinalOrderState({ items: [] });
  assert.equal(state.status, 'empty');
  assert.equal(state.reviewComplete, true);
  assert.equal(state.totalAmount, 0);
});

test('позиции без заказного действия исключаются', () => {
  for (const workflowStatus of [
    'no_order_action',
    'confidently_excluded',
    'postponed',
    null,
  ]) {
    const classification = classifyItem(item({
      workflow_status: workflowStatus,
      quantities: { approved_quantity: null },
    }));
    assert.equal(classification.kind, 'excluded', workflowStatus);
    assert.equal(classification.reason, 'no_order');
  }
});
