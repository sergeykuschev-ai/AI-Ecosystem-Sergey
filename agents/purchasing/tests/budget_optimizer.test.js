const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  BudgetOptimizerError,
  optimizePurchasingBudget,
} = require('../budget_optimizer/budget_optimizer');

function product({
  id,
  decision,
  quantity,
  price,
  mandatory = false,
  mandatoryMinimumGap = 0,
  minimumOrderQuantity,
  abc = 'C',
  xyz = 'Z',
}) {
  return {
    working: {
      rowIdentity: id,
      rowNumber: Number(id.replace(/\D/g, '')) || 1,
      article: `SKU-${id}`,
      name: `Товар ${id}`,
      supplier: 'Поставщик',
      phase2Decision: decision,
      analyzerCalculatedQuantity: quantity,
      phase1LineSum: quantity * price,
      priceNum: price,
      minimumOrderQuantity,
      assortment_matrix: {
        matched: mandatory,
        priority: mandatory ? 'critical' : 'standard',
      },
      abc,
      xyz,
    },
    decision: {
      rowIdentity: id,
      decision,
      decisionScore: 50,
    },
    demand: {
      rowIdentity: id,
      mandatoryAssortment: mandatory,
      mandatoryMinimumGap,
    },
  };
}

function agentResult(entries) {
  return [{
    json: {
      workingOrderProducts: entries.map(entry => entry.working),
      decisions: entries.map(entry => entry.decision),
      demandProducts: entries.map(entry => entry.demand),
    },
  }];
}

function standardEntries() {
  return [
    product({
      id: '1',
      decision: 'must_buy',
      quantity: 2,
      price: 100,
      abc: 'A',
      xyz: 'X',
    }),
    product({
      id: '2',
      decision: 'postpone',
      quantity: 2,
      price: 10,
    }),
    product({
      id: '3',
      decision: 'manual_review',
      quantity: 2,
      price: 20,
    }),
    product({
      id: '4',
      decision: 'recommended',
      quantity: 2,
      price: 30,
    }),
  ];
}

function bySku(result, sku) {
  return [...result.items, ...result.removedItems]
    .find(item => item.sku === sku);
}

test('budget above the original total keeps the order unchanged', () => {
  const result = optimizePurchasingBudget({
    agentResult: agentResult(standardEntries()),
    targetBudget: 500,
  });

  assert.equal(result.status, 'UNCHANGED');
  assert.equal(result.originalTotal, 320);
  assert.equal(result.optimizedTotal, 320);
  assert.equal(result.removedAmount, 0);
  assert.equal(result.changedItemsCount, 0);
  assert.equal(result.removedItems.length, 0);
});

test('POSTPONE is reduced before MANUAL_REVIEW and RECOMMENDED', () => {
  const result = optimizePurchasingBudget({
    agentResult: agentResult(standardEntries()),
    targetBudget: 300,
  });

  assert.equal(bySku(result, 'SKU-2').optimizedQuantity, 0);
  assert.equal(bySku(result, 'SKU-3').optimizedQuantity, 2);
  assert.equal(bySku(result, 'SKU-4').optimizedQuantity, 2);
});

test('MANUAL_REVIEW is reduced after POSTPONE', () => {
  const result = optimizePurchasingBudget({
    agentResult: agentResult(standardEntries()),
    targetBudget: 260,
  });

  assert.equal(bySku(result, 'SKU-2').optimizedQuantity, 0);
  assert.equal(bySku(result, 'SKU-3').optimizedQuantity, 0);
  assert.equal(bySku(result, 'SKU-4').optimizedQuantity, 2);
});

test('RECOMMENDED is reduced only after earlier decision groups', () => {
  const result = optimizePurchasingBudget({
    agentResult: agentResult(standardEntries()),
    targetBudget: 200,
  });

  assert.equal(bySku(result, 'SKU-2').optimizedQuantity, 0);
  assert.equal(bySku(result, 'SKU-3').optimizedQuantity, 0);
  assert.equal(bySku(result, 'SKU-4').optimizedQuantity, 0);
});

test('MUST_BUY quantity is never reduced or removed', () => {
  const result = optimizePurchasingBudget({
    agentResult: agentResult(standardEntries()),
    targetBudget: 1,
  });

  const mustBuy = bySku(result, 'SKU-1');
  assert.equal(mustBuy.originalQuantity, 2);
  assert.equal(mustBuy.optimizedQuantity, 2);
  assert.deepEqual(mustBuy.protectedReasons, ['MUST_BUY']);
});

test('mandatory assortment retains its business minimum', () => {
  const entries = [
    product({
      id: '1',
      decision: 'recommended',
      quantity: 4,
      price: 50,
      mandatory: true,
      mandatoryMinimumGap: 2,
    }),
    product({
      id: '2',
      decision: 'recommended',
      quantity: 2,
      price: 25,
    }),
  ];
  const result = optimizePurchasingBudget({
    agentResult: agentResult(entries),
    targetBudget: 100,
  });

  const mandatory = bySku(result, 'SKU-1');
  assert.equal(mandatory.optimizedQuantity, 2);
  assert.equal(mandatory.minimumQuantity, 2);
  assert.ok(
    mandatory.protectedReasons.includes('MANDATORY_ASSORTMENT')
  );
});

test('explicit minimum quantity one is preserved', () => {
  const entry = product({
    id: '1',
    decision: 'recommended',
    quantity: 3,
    price: 40,
    minimumOrderQuantity: 1,
  });
  const result = optimizePurchasingBudget({
    agentResult: agentResult([entry]),
    targetBudget: 40,
  });

  assert.equal(result.items[0].optimizedQuantity, 1);
  assert.deepEqual(
    result.items[0].protectedReasons,
    ['MINIMUM_ORDER_QUANTITY']
  );
});

test('optimized total does not exceed a feasible budget', () => {
  const result = optimizePurchasingBudget({
    agentResult: agentResult(standardEntries()),
    targetBudget: 275,
  });

  assert.equal(result.status, 'OPTIMIZED');
  assert.ok(result.optimizedTotal <= 275);
  assert.equal(result.originalTotal - result.optimizedTotal,
    result.removedAmount);
});

test('budget below protected total returns BUDGET_TOO_LOW', () => {
  const entries = [
    product({
      id: '1',
      decision: 'must_buy',
      quantity: 2,
      price: 100,
    }),
    product({
      id: '2',
      decision: 'recommended',
      quantity: 3,
      price: 50,
      mandatory: true,
      mandatoryMinimumGap: 1,
    }),
    product({
      id: '3',
      decision: 'postpone',
      quantity: 2,
      price: 10,
    }),
  ];
  const result = optimizePurchasingBudget({
    agentResult: agentResult(entries),
    targetBudget: 100,
  });

  assert.equal(result.status, 'BUDGET_TOO_LOW');
  assert.equal(result.minimumPossibleTotal, 250);
  assert.equal(result.optimizedTotal, 250);
  assert.deepEqual(result.warnings,
    ['TARGET_BUDGET_BELOW_MANDATORY_MINIMUM', 'BUDGET_CONFLICT_PROTECTED_ITEMS']);
  assert.equal(bySku(result, 'SKU-1').optimizedQuantity, 2);
  assert.equal(bySku(result, 'SKU-2').optimizedQuantity, 1);
});

test('optimizer does not mutate the original result', () => {
  const source = agentResult(standardEntries());
  const before = structuredClone(source);

  optimizePurchasingBudget({
    agentResult: source,
    targetBudget: 210,
  });

  assert.deepEqual(source, before);
});

test('invalid target budget is rejected clearly', () => {
  assert.throws(
    () => optimizePurchasingBudget({
      agentResult: agentResult(standardEntries()),
      targetBudget: -1,
    }),
    error =>
      error instanceof BudgetOptimizerError &&
      error.code === 'BUDGET_OPTIMIZER_INVALID_INPUT'
  );
});

function included({ rowId, sku, quantity, price, source = 'auto' }) {
  return {
    rowId,
    sku,
    name: `Товар ${sku}`,
    supplier: 'Поставщик',
    quantity,
    price,
    source,
  };
}

function finalOrder(entries, reviewComplete = true) {
  return { reviewComplete, includedItems: entries };
}

test('finalOrder: оптимизируется утверждённый заказ, а не рекомендация AI',
  () => {
    const result = optimizePurchasingBudget({
      finalOrder: finalOrder([
        included({ rowId: 'r1', sku: 'A-1', quantity: 3, price: 10.5 }),
        included({
          rowId: 'r2', sku: 'B-2', quantity: 2, price: 100, source: 'manual',
        }),
      ]),
      targetBudget: 500,
    });
    assert.equal(result.originalTotal, 231.5);
    assert.equal(result.status, 'UNCHANGED');
    assert.equal(result.optimizedTotal, 231.5);
    assert.equal(result.items.length, 2);
  });

test('finalOrder: сначала сокращаются auto, решения владельца не сокращаются',
  () => {
    const entries = [
      included({ rowId: 'r1', sku: 'A-1', quantity: 2, price: 10 }),
      included({
        rowId: 'r2', sku: 'B-2', quantity: 2, price: 100, source: 'manual',
      }),
    ];
    const gentle = optimizePurchasingBudget({
      finalOrder: finalOrder(entries),
      targetBudget: 200,
    });
    assert.equal(gentle.optimizedTotal, 200);
    assert.equal(bySku(gentle, 'B-2').optimizedQuantity, 2);
    assert.ok(
      gentle.removedItems.some(item => item.sku === 'A-1'),
      'auto-позиция должна быть исключена первой'
    );

    const hard = optimizePurchasingBudget({
      finalOrder: finalOrder(entries),
      targetBudget: 100,
    });
    assert.equal(hard.status, 'BUDGET_TOO_LOW');
    assert.equal(hard.optimizedTotal, 200);
    assert.equal(bySku(hard, 'B-2').optimizedQuantity, 2);
    assert.deepEqual(bySku(hard, 'B-2').protectedReasons, ['OWNER_BUY']);
    assert.ok(
      hard.warnings.includes('OWNER_BUY_PROTECTED_FROM_BUDGET_CUT'),
      'должно быть явное предупреждение о защите OWNER BUY'
    );
  });

test('finalOrder: OWNER BUY не удаляется даже при крайне малом бюджете',
  () => {
    const entries = [
      included({
        rowId: 'r1', sku: 'B-1', quantity: 5, price: 100, source: 'manual',
      }),
    ];
    const result = optimizePurchasingBudget({
      finalOrder: finalOrder(entries),
      targetBudget: 1,
    });
    assert.equal(result.status, 'BUDGET_TOO_LOW');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].optimizedQuantity, 5);
    assert.equal(result.items[0].originalQuantity, 5);
    assert.ok(result.warnings.includes('OWNER_BUY_PROTECTED_FROM_BUDGET_CUT'));
  });

test('finalOrder: нерешённая проверка блокирует оптимизацию', () => {
  assert.throws(
    () => optimizePurchasingBudget({
      finalOrder: finalOrder([
        included({ rowId: 'r1', sku: 'A-1', quantity: 1, price: 10 }),
      ], false),
      targetBudget: 100,
    }),
    error => error.code === 'OWNER_REVIEW_INCOMPLETE' &&
      error.message.includes('Завершите ручную проверку')
  );
  assert.throws(
    () => optimizePurchasingBudget({
      finalOrder: { includedItems: [] },
      targetBudget: 100,
    }),
    error => error.code === 'OWNER_REVIEW_INCOMPLETE'
  );
});

test('finalOrder: позиция без цены даёт понятную ошибку, а не 500', () => {
  assert.throws(
    () => optimizePurchasingBudget({
      finalOrder: finalOrder([
        included({ rowId: 'r1', sku: 'A-1', quantity: 1, price: null }),
      ]),
      targetBudget: 100,
    }),
    error => error.code === 'BUDGET_OPTIMIZER_INVALID_INPUT' &&
      error.message.includes('отсутствует закупочная цена')
  );
});

test('finalOrder: суммы строк сходятся с итогом без ошибок округления', () => {
  const input = {
    finalOrder: finalOrder([
      included({ rowId: 'r1', sku: 'A-1', quantity: 3, price: 0.335 }),
      included({ rowId: 'r2', sku: 'A-2', quantity: 7, price: 0.145 }),
      included({
        rowId: 'r3', sku: 'A-3', quantity: 2, price: 33.27,
        source: 'manual',
      }),
    ]),
    targetBudget: 67,
  };
  const first = optimizePurchasingBudget(input);
  const second = optimizePurchasingBudget(input);
  assert.deepEqual(first, second, 'повторный запуск обязан совпадать');
  const linesSum = Math.round(
    first.items.reduce((sum, item) => sum + item.optimizedAmount, 0) * 100
  );
  assert.equal(linesSum, Math.round(first.optimizedTotal * 100));
  assert.ok(first.optimizedTotal <= 67);
  assert.ok(
    first.items.some(
      item => item.sku === 'A-3' && item.optimizedQuantity === 2
    ),
    'OWNER BUY остаётся неизменным при округлении'
  );
});

test('finalOrder: некорректное состояние отклоняется', () => {
  assert.throws(
    () => optimizePurchasingBudget({
      finalOrder: null,
      targetBudget: 100,
    }),
    error => error.code === 'BUDGET_OPTIMIZER_INVALID_INPUT'
  );
  assert.throws(
    () => optimizePurchasingBudget({
      finalOrder: { reviewComplete: true },
      targetBudget: 100,
    }),
    error => error.code === 'BUDGET_OPTIMIZER_INVALID_INPUT'
  );
});

test('finalOrder: изменение бюджета пересчитывает результат', () => {
  const entries = [
    included({ rowId: 'r1', sku: 'A-1', quantity: 5, price: 20 }),
    included({ rowId: 'r2', sku: 'A-2', quantity: 5, price: 30 }),
  ];
  const budgets = [250, 200, 150, 100, 200];
  const totals = budgets.map(targetBudget =>
    optimizePurchasingBudget({
      finalOrder: finalOrder(entries),
      targetBudget,
    }).optimizedTotal
  );
  assert.ok(totals[1] <= totals[0]);
  assert.ok(totals[2] <= totals[1]);
  assert.ok(totals[3] <= totals[2]);
  assert.equal(
    totals[4],
    totals[1],
    'возврат к бюджету 200 восстанавливает тот же результат'
  );
});
