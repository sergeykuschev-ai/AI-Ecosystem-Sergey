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
    ['TARGET_BUDGET_BELOW_MANDATORY_MINIMUM']);
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
