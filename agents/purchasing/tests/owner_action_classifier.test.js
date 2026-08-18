'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  OWNER_ACTION_CLASSES,
  classifyOwnerAction,
} = require('../services/owner_action_classifier');

const {
  OWNER_ACTION_REQUIRED,
  WARNING_ONLY,
  SAFE_NO_ORDER,
  POSTPONED,
  RESOLVED,
} = OWNER_ACTION_CLASSES;

function item(overrides = {}) {
  return {
    decision: null,
    workflow_status: null,
    owner_decision: { decision: null },
    matrix: {
      role: 'OPTIONAL',
      owner_review_required: false,
      reason_codes: [],
      owner_review_reasons: [],
      missing_fields: [],
    },
    quantities: {
      approved_quantity: null,
      provisional_quantity: null,
      calculated_quantity: null,
      analyzer_quantity: null,
    },
    amounts: { unit_price: 100 },
    ...overrides,
  };
}

test('positive pending qty with owner_review_required → OWNER_ACTION_REQUIRED', () => {
  const result = classifyOwnerAction(item({
    quantities: { approved_quantity: 5 },
    matrix: { owner_review_required: true },
  }));
  assert.equal(result, OWNER_ACTION_REQUIRED);
});

test('approved_policy_conflict → OWNER_ACTION_REQUIRED', () => {
  const result = classifyOwnerAction(item({
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['approved_policy_conflict'],
      owner_review_reasons: ['approved_policy_conflict'],
    },
  }));
  assert.equal(result, OWNER_ACTION_REQUIRED);
});

test('ambiguous_identity → OWNER_ACTION_REQUIRED', () => {
  const result = classifyOwnerAction(item({
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['ambiguous_identity'],
      owner_review_reasons: ['commercial_review'],
    },
  }));
  assert.equal(result, OWNER_ACTION_REQUIRED);
});

test('Financial Controller stopped real order → OWNER_ACTION_REQUIRED', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'confidently_excluded',
    quantities: {
      approved_quantity: 0,
      calculated_quantity: 0,
      analyzer_quantity: 2,
    },
    amounts: { unit_price: 200 },
    matrix: {
      role: 'OPTIONAL',
      owner_review_required: true,
      reason_codes: ['supplier_recommends_order'],
      owner_review_reasons: ['commercial_review'],
    },
  }));
  assert.equal(result, OWNER_ACTION_REQUIRED);
});

test('large_inventory warning only → WARNING_ONLY', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'no_order_action',
    decision: 'do_not_buy',
    quantities: { approved_quantity: 0, analyzer_quantity: 0 },
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['large_inventory_days'],
      owner_review_reasons: ['large_inventory_review'],
    },
  }));
  assert.equal(result, WARNING_ONLY);
});

test('missing_stable_identifier → WARNING_ONLY', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'no_order_action',
    quantities: { approved_quantity: 0 },
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['missing_stable_identifier'],
      owner_review_reasons: ['commercial_review', 'insufficient_data'],
    },
  }));
  assert.equal(result, WARNING_ONLY);
});

test('EXIT without conflict → SAFE_NO_ORDER', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'no_order_action',
    decision: 'do_not_buy',
    matrix: {
      role: 'EXIT',
      reason_codes: ['exit_no_sales_26_weeks'],
      owner_review_reasons: ['exit_candidate', 'insufficient_data'],
    },
  }));
  assert.equal(result, SAFE_NO_ORDER);
});

test('OPTIONAL unknown stock with confident no-buy → SAFE_NO_ORDER', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'no_order_action',
    quantities: { approved_quantity: 0, analyzer_quantity: 0 },
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['missing_inventory_data'],
      owner_review_reasons: ['commercial_review', 'insufficient_data'],
      missing_fields: ['free_stock'],
    },
  }));
  assert.equal(result, SAFE_NO_ORDER);
});

test('postponed → POSTPONED', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'postponed',
    quantities: { approved_quantity: 1 },
  }));
  assert.equal(result, POSTPONED);
});

test('owner BUY → RESOLVED', () => {
  const result = classifyOwnerAction(item({
    owner_decision: { decision: 'BUY', quantity: 5 },
  }));
  assert.equal(result, RESOLVED);
});

test('owner SKIP → RESOLVED', () => {
  const result = classifyOwnerAction(item({
    owner_decision: { decision: 'SKIP' },
  }));
  assert.equal(result, RESOLVED);
});

test('positive pending qty without owner_review_required → SAFE_NO_ORDER', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'pending_manual_review',
    quantities: { provisional_quantity: 1 },
    matrix: { owner_review_required: false },
  }));
  assert.equal(result, SAFE_NO_ORDER);
});

test('CORE with missing stock → OWNER_ACTION_REQUIRED', () => {
  const result = classifyOwnerAction(item({
    matrix: {
      role: 'CORE',
      reason_codes: ['missing_inventory_data'],
      owner_review_reasons: ['insufficient_data'],
      missing_fields: ['free_stock'],
    },
  }));
  assert.equal(result, OWNER_ACTION_REQUIRED);
});

test(' Financial Controller tiny order (< 100 ₽) → SAFE_NO_ORDER', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'confidently_excluded',
    quantities: {
      approved_quantity: 0,
      analyzer_quantity: 1,
    },
    amounts: { unit_price: 50 },
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['supplier_recommends_order'],
    },
  }));
  assert.equal(result, SAFE_NO_ORDER);
});

test('auto-approved positive position → RESOLVED', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'auto_approved',
    decision: 'must_buy',
    quantities: { approved_quantity: 10 },
    matrix: {
      role: 'CORE',
      owner_review_required: false,
      reason_codes: ['stable_sales'],
    },
  }));
  assert.equal(result, RESOLVED);
});

test('commercial_review/insufficient_data with confident zero → SAFE_NO_ORDER', () => {
  const result = classifyOwnerAction(item({
    workflow_status: 'no_order_action',
    decision: 'do_not_buy',
    quantities: { approved_quantity: 0, analyzer_quantity: 0 },
    matrix: {
      role: 'OPTIONAL',
      reason_codes: ['missing_inventory_data'],
      owner_review_reasons: ['commercial_review', 'insufficient_data'],
      missing_fields: ['free_stock'],
    },
  }));
  assert.equal(result, SAFE_NO_ORDER);
});
