'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildFinalOrderState,
} = require('../../../agents/purchasing/services/final_order');
const {
  buildSupplierOrder,
  buildSupplierOrderXlsx,
} = require('../../../agents/purchasing/services/supplier_order');
const {
  finalQuantityWithOwnerDecision,
  withFinalQuantity,
} = require('../application/owner_decision_service');
const {
  itemMatches,
} = require('../application/run_query_service');
const {
  mapPurchasingItems,
} = require('../dto/purchasing_item_mapper');
const {
  itemMatchesDecisionFilter,
  recommendedQuantity,
} = require('../public/app');

function item(overrides = {}) {
  return {
    row_id: 'row-1',
    sku: 'SKU-1',
    name: 'Policy item',
    supplier: 'Supplier',
    workflow_status: 'auto_approved',
    quantities: {
      calculated_quantity: 5,
      minmax_quantity: 5,
      policy_quantity: 2,
      approved_quantity: 2,
      provisional_quantity: null,
      final_quantity: 2,
    },
    amounts: { unit_price: 10, approved_line_value: 20 },
    matrix: { owner_review_required: false },
    assortment_policy: { matched: true, adjusted: true, rule: 'MAX_STOCK' },
    owner_decision: { decision: null, quantity: null },
    ...overrides,
  };
}

function mappedBundle() {
  return {
    agentResult: [{ json: {
      decisions: [{ rowIdentity: 'row-1', decision: 'recommended' }],
      workingOrderProducts: [{
        rowIdentity: 'row-1',
        rowNumber: 1,
        article: 'SKU-1',
        name: 'Policy item',
        supplier: 'Supplier',
        workflowStatus: 'auto_approved',
        analyzerCalculatedQuantity: 5,
        minmaxRecommendedQuantity: 5,
        finalRecommendedQuantity: 2,
        approvedOrderQuantity: 2,
        provisionalOrderQuantity: null,
        approvedLineSum: 20,
        priceNum: 10,
        freeStock: 4,
        assortmentPolicy: {
          matched: true,
          minmax_qty: 5,
          policy_qty: 2,
          policy_rule: 'MAX_STOCK',
          applied_rules: ['MAX_STOCK'],
          explanation: 'Ограничено MAX.',
          policy_adjusted: true,
          projected_stock: 6,
          policy_warnings: [],
          assortment_status: 'CORE',
          min_stock: 3,
          max_stock: 6,
          target_stock: null,
          order_mode: 'PIECE',
          box_qty: null,
          display_stock: false,
          display_min_qty: null,
          purchase_hold: false,
          purchase_hold_until_stock: null,
          mandatory_assortment: false,
          owner_comment: '',
          rule_source: 'OWNER',
        },
      }],
    } }],
    matrixDraft: { items: [{ rowIdentity: 'row-1' }] },
    ownerReview: { items: [{ rowIdentity: 'row-1', owner_action_required: false }], sections: {} },
    explanations: { items: [{}] },
  };
}

test('29-30. DTO keeps MinMax, policy and approved quantities separate for Owner Review', () => {
  const [mapped] = mapPurchasingItems(mappedBundle());
  assert.deepEqual(mapped.quantities, {
    analyzer_quantity: 5,
    calculated_quantity: 5,
    minmax_quantity: 5,
    policy_quantity: 2,
    approved_quantity: 2,
    provisional_quantity: null,
    final_quantity: 2,
  });
  assert.equal(mapped.assortment_policy.adjusted, true);
  assert.equal(mapped.assortment_policy.projected_stock, 6);
});

test('25 and 28. BUY owner quantity overrides policy and FinalOrderState', () => {
  const owned = withFinalQuantity(item({
    owner_decision: { decision: 'BUY', quantity: 9 },
  }));
  assert.equal(finalQuantityWithOwnerDecision(owned), 9);
  assert.equal(owned.quantities.final_quantity, 9);
  assert.equal(buildFinalOrderState({ items: [owned] }).includedItems[0].quantity, 9);
});

test('26. SKIP excludes policy item', () => {
  const skipped = withFinalQuantity(item({
    owner_decision: { decision: 'SKIP', quantity: 0 },
  }));
  assert.equal(skipped.quantities.final_quantity, 0);
  assert.equal(buildFinalOrderState({ items: [skipped] }).includedItems.length, 0);
});

test('27. DEFER excludes policy item from current order', () => {
  const deferred = withFinalQuantity(item({
    owner_decision: { decision: 'DEFER', quantity: null },
  }));
  const state = buildFinalOrderState({ items: [deferred] });
  assert.equal(deferred.quantities.final_quantity, null);
  assert.equal(state.excludedItems[0].reason, 'deferred');
});

test('policy-adjusted API filter selects only adjusted positions', () => {
  const filters = {
    q: null,
    decision: null,
    workflow_status: null,
    matrix_role: null,
    confidence: null,
    owner_review: null,
    positive_order: null,
    policy_adjusted: true,
    owner_decision: null,
  };
  assert.equal(itemMatches(item(), filters), true);
  assert.equal(itemMatches(item({
    assortment_policy: { matched: false, adjusted: false },
  }), filters), false);
});

test('31. UI contract displays the same policy quantity exposed by API', () => {
  const [mapped] = mapPurchasingItems(mappedBundle());
  const frontend = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.equal(mapped.quantities.policy_quantity, 2);
  assert.match(frontend, /quantities\?\.policy_quantity/);
  assert.match(frontend, /После политики/);
  assert.match(html, /Скорректировано политикой/);
});

test('32. JSON DTO contains canonical owner-adjustable final quantity', () => {
  const mapped = withFinalQuantity(mapPurchasingItems(mappedBundle())[0]);
  const roundTrip = JSON.parse(JSON.stringify(mapped));
  assert.equal(roundTrip.quantities.final_quantity, 2);
});

test('33-35. supplier row and XLSX use FinalOrderState quantity', () => {
  const owned = item({ owner_decision: { decision: 'BUY', quantity: 7 } });
  const order = buildSupplierOrder({
    items: [owned],
    supplier: 'Supplier',
    generatedAt: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(order.rows[0].quantity, 7);
  const xlsx = buildSupplierOrderXlsx(order);
  assert.ok(xlsx instanceof Uint8Array);
  assert.ok(xlsx.length > 0);
});

test('36. budget input remains canonical FinalOrderState', () => {
  const state = buildFinalOrderState({ items: [item()] });
  assert.equal(state.includedItems[0].quantity, 2);
  assert.equal(state.totalAmount, 20);
});

test('41-43. legacy item without policy opens, filters and exports', () => {
  const legacy = item({
    quantities: { approved_quantity: 3 },
    assortment_policy: undefined,
  });
  assert.equal(finalQuantityWithOwnerDecision(legacy), 3);
  assert.doesNotThrow(() => buildFinalOrderState({ items: [legacy] }));
  const order = buildSupplierOrder({
    items: [legacy],
    supplier: 'Supplier',
    generatedAt: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(order.rows[0].quantity, 3);
});

test('GAL5427740 UI shows mandatory provisional quantity only for known stock', () => {
  const knownZero = item({
    workflow_status: 'pending_manual_review',
    quantities: {
      calculated_quantity: 0,
      minmax_quantity: 0,
      policy_quantity: 2,
      approved_quantity: null,
      provisional_quantity: 2,
      final_quantity: 2,
    },
    assortment_policy: {
      matched: true,
      adjusted: true,
      rule: 'MANDATORY_ASSORTMENT',
    },
  });
  const unknownStock = item({
    quantities: {
      calculated_quantity: null,
      minmax_quantity: null,
      policy_quantity: null,
      approved_quantity: null,
      provisional_quantity: null,
      final_quantity: null,
    },
    assortment_policy: {
      matched: true,
      adjusted: false,
      rule: 'NONE',
    },
  });

  assert.equal(recommendedQuantity(knownZero), 2);
  assert.equal(itemMatchesDecisionFilter(knownZero, 'policy'), true);
  assert.equal(recommendedQuantity(unknownStock), null);
  assert.equal(itemMatchesDecisionFilter(unknownStock, 'policy'), false);
});
