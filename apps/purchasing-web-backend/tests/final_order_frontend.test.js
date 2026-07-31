'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  finalOrderUrl,
  finalOrderView,
} = require('../public/app');

const READY_STATE = {
  status: 'ready',
  reviewComplete: true,
  itemCount: 84,
  totalQuantity: 210,
  totalAmount: 67987.86,
  autoApprovedAmount: 45000.5,
  manuallyApprovedAmount: 22987.36,
  skippedAmount: 30000,
  deferredAmount: 0,
  unresolvedCount: 0,
  unresolvedAmount: 0,
  remainingBudget: 32512.14,
  initialRecommendation: {
    itemCount: 609,
    totalAmount: 107483.43,
  },
};

test('finalOrderUrl формирует адрес канонического состояния', () => {
  assert.equal(
    finalOrderUrl('12121212-1212-4212-8212-121212121212'),
    '/api/v1/runs/12121212-1212-4212-8212-121212121212/final-order'
  );
  assert.equal(finalOrderUrl('не id'), null);
  assert.equal(finalOrderUrl(null), null);
});

test('finalOrderView показывает финальные значения после проверки', () => {
  const view = finalOrderView(READY_STATE);
  assert.ok(view);
  assert.equal(view.totalAmount.replace(/[^\d,]/g, ''), '67987,86');
  assert.equal(view.itemCount, '84');
  assert.equal(view.autoApprovedSum.replace(/[^\d,]/g, ''), '45000,50');
  assert.equal(view.pendingReviewSum.replace(/[^\d,]/g, ''), '0,00');
  assert.equal(view.runStatus, 'Проверка завершена');
  assert.equal(view.runStatusCode, 'Все ручные решения приняты');
  assert.equal(view.ownerReviewCount, '0 позиций для решения · проверка завершена');
  assert.equal(view.remainingBudget, 32512.14);
  assert.ok(view.initialRecommendation.includes('107'));
  assert.ok(view.initialRecommendation.includes('609'));
});

test('finalOrderView при незавершённой проверке не выставляет статус готовности',
  () => {
    const view = finalOrderView({
      ...READY_STATE,
      status: 'review_incomplete',
      reviewComplete: false,
      unresolvedCount: 12,
      unresolvedAmount: 1234.5,
    });
    assert.ok(view);
    assert.equal(view.runStatus, null);
    assert.equal(view.runStatusCode, null);
    assert.equal(view.pendingReviewSum.replace(/[^\d,]/g, ''), '1234,50');
    assert.equal(view.ownerReviewCount, '12 позиций для решения');
  });

test('finalOrderView отклоняет некорректное состояние', () => {
  assert.equal(finalOrderView(null), null);
  assert.equal(finalOrderView({}), null);
  assert.equal(
    finalOrderView({ ...READY_STATE, totalAmount: Number.NaN }),
    null
  );
  assert.equal(
    finalOrderView({ ...READY_STATE, reviewComplete: 'да' }),
    null
  );
  assert.equal(
    finalOrderView({ ...READY_STATE, itemCount: -3 }),
    null
  );
});

test('finalOrderView корректно обрабатывает пустой бюджет и исходную рекомендацию',
  () => {
    const view = finalOrderView({
      ...READY_STATE,
      remainingBudget: null,
      initialRecommendation: { itemCount: null, totalAmount: null },
    });
    assert.ok(view);
    assert.equal(view.remainingBudget, null);
    assert.equal(view.initialRecommendation, '—');
  });
