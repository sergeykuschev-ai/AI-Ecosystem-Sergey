const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { OwnerDecisionService } = require('../application/owner_decision_service');

const RUN_ID = '12121212-1212-4121-8121-121212121212';
const ROW_ID = 'smartzapas:fixture:Лист_1:10';

const ROLLOUT_ITEM = Object.freeze({
  row_id: ROW_ID,
  source_row: 10,
  sku: 'CARE-TEST-1',
  barcode: '460000000010',
  name: 'TEST Shampoo 250 ml',
  brand: 'CareBrand',
  supplier: 'CareSupplier',
  category: 'Care',
  decision: 'manual_review',
  workflow_status: 'pending_manual_review',
  first_rollout_test_awaiting: true,
  review_after_days: 30,
  rollout_status: 'FIRST_ROLLOUT',
  matrix: { owner_review_required: true },
  stock: { free_stock: 5 },
  sales: { last_28_days: 0 },
  quantities: {
    calculated_quantity: 7,
    approved_quantity: 0,
    provisional_quantity: 7,
    rollout_recommended_quantity: 7,
  },
  amounts: { provisional_line_value: 700 },
  assortment_policy: {
    rollout_status: 'FIRST_ROLLOUT',
    review_after_days: 30,
  },
  owner_decision: {
    status: 'none',
    decision: null,
    quantity: null,
  },
});

const ACTIVE_TEST_ITEM = Object.freeze({
  row_id: 'smartzapas:fixture:Лист_1:11',
  source_row: 11,
  sku: 'CARE-TEST-2',
  name: 'TEST Conditioner',
  supplier: 'CareSupplier',
  category: 'Care',
  decision: 'recommended',
  workflow_status: 'pending_manual_review',
  first_rollout_test_awaiting: false,
  review_after_days: null,
  rollout_status: 'ACTIVE',
  matrix: { owner_review_required: true },
  stock: { free_stock: 2 },
  quantities: {
    calculated_quantity: 5,
    approved_quantity: 5,
    provisional_quantity: null,
    rollout_recommended_quantity: null,
  },
  amounts: { approved_line_value: 500 },
  assortment_policy: {
    rollout_status: 'ACTIVE',
    review_after_days: null,
  },
  owner_decision: {
    status: 'none',
    decision: null,
    quantity: null,
  },
});

class RolloutRegistry {
  constructor(items) {
    this.items = structuredClone(items);
  }

  getRunStatus() {
    return { run_id: RUN_ID, status: 'completed', stage: 'complete' };
  }

  getItems(runId) {
    if (runId !== RUN_ID) throw new Error('Run not found');
    return structuredClone(this.items);
  }

  getRunSummary() {
    return {
      currency: 'RUB',
      amounts: { analyzer_order_sum: 700 },
      applied_working_order_financial: { amount_after: 700, financial_status: 'APPROVED' },
    };
  }
}

function createService(options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-first-rollout-'
  ));
  const decisionsPath = path.join(temporaryRoot, 'owner-decisions.json');
  const historyPath = path.join(temporaryRoot, 'owner-decision-history.json');
  const service = new OwnerDecisionService({
    registry: new RolloutRegistry(options.items || [ROLLOUT_ITEM]),
    ownerDecisionsPath: decisionsPath,
    ownerDecisionHistoryPath: historyPath,
    now: () => '2026-08-01T10:00:00.000Z',
    ...options.serviceOptions,
  });
  return { service, decisionsPath, historyPath, temporaryRoot };
}

function cleanup(context) {
  fs.rmSync(context.temporaryRoot, { recursive: true, force: true });
}

test('BUY_NOW for FIRST_ROLLOUT TEST stores original_decision and maps to BUY internally', () => {
  const ctx = createService();
  try {
    const result = ctx.service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'BUY_NOW',
      quantity: 7,
      reasonCode: 'NEW_PRODUCT',
      comment: 'Approve first introduction',
    });

    assert.equal(result.item.owner_decision.decision, 'BUY');
    assert.equal(result.item.owner_decision.original_decision, 'BUY_NOW');
    assert.equal(result.item.owner_decision.quantity, 7);
    assert.equal(result.item.quantities.final_quantity, 7);

    const stored = JSON.parse(fs.readFileSync(ctx.decisionsPath, 'utf8'));
    assert.equal(stored.decisions.length, 1);
    assert.equal(stored.decisions[0].owner_decision, 'BUY');
    assert.equal(stored.decisions[0].original_decision, 'BUY_NOW');
    assert.equal(stored.decisions[0].owner_order_quantity, 7);
    assert.equal(stored.decisions[0].scope, 'run');

    const history = JSON.parse(fs.readFileSync(ctx.historyPath, 'utf8'));
    assert.equal(history.entries[0].ownerDecision, 'BUY_NOW');
  } finally {
    cleanup(ctx);
  }
});

test('POSTPONE for FIRST_ROLLOUT TEST stores original_decision and maps to DEFER with review date', () => {
  const ctx = createService();
  try {
    const result = ctx.service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'POSTPONE',
      quantity: null,
      reasonCode: 'PRICE_TOO_HIGH',
      comment: 'Wait for demand validation',
    });

    assert.equal(result.item.owner_decision.decision, 'DEFER');
    assert.equal(result.item.owner_decision.original_decision, 'POSTPONE');
    assert.equal(result.item.owner_decision.quantity, null);
    assert.equal(result.item.test_review_date, '2026-08-31');
    assert.equal(result.item.quantities.final_quantity, 0);

    const stored = JSON.parse(fs.readFileSync(ctx.decisionsPath, 'utf8'));
    assert.equal(stored.decisions.length, 1);
    assert.equal(stored.decisions[0].owner_decision, 'DEFER');
    assert.equal(stored.decisions[0].original_decision, 'POSTPONE');
    assert.equal(stored.decisions[0].original_decision_review_date, '2026-08-31');
    assert.equal(stored.decisions[0].expires_at, '2026-08-31T10:00:00.000Z');
    assert.equal(stored.decisions[0].scope, 'run');

    const history = JSON.parse(fs.readFileSync(ctx.historyPath, 'utf8'));
    assert.equal(history.entries[0].ownerDecision, 'POSTPONE');
  } finally {
    cleanup(ctx);
  }
});

test('REMOVE_FROM_MATRIX for FIRST_ROLLOUT TEST stores original_decision and maps to SKIP internally', () => {
  const ctx = createService();
  try {
    const result = ctx.service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'REMOVE_FROM_MATRIX',
      quantity: null,
      reasonCode: 'LOW_MARGIN',
      comment: 'Remove from matrix',
    });

    assert.equal(result.item.owner_decision.decision, 'SKIP');
    assert.equal(result.item.owner_decision.original_decision, 'REMOVE_FROM_MATRIX');
    assert.equal(result.item.owner_decision.quantity, 0);
    assert.equal(result.item.quantities.final_quantity, 0);

    const stored = JSON.parse(fs.readFileSync(ctx.decisionsPath, 'utf8'));
    assert.equal(stored.decisions.length, 1);
    assert.equal(stored.decisions[0].owner_decision, 'SKIP');
    assert.equal(stored.decisions[0].original_decision, 'REMOVE_FROM_MATRIX');
    assert.equal(stored.decisions[0].owner_order_quantity, 0);

    const history = JSON.parse(fs.readFileSync(ctx.historyPath, 'utf8'));
    assert.equal(history.entries[0].ownerDecision, 'REMOVE_FROM_MATRIX');
  } finally {
    cleanup(ctx);
  }
});

test('POSTPONE review date respects configured review_after_days', () => {
  const ctx = createService({
    serviceOptions: {
      now: () => '2026-08-01T10:00:00.000Z',
    },
  });
  try {
    const result = ctx.service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'POSTPONE',
      quantity: null,
    });

    assert.equal(result.item.test_review_date, '2026-08-31');
    const stored = JSON.parse(fs.readFileSync(ctx.decisionsPath, 'utf8'));
    assert.equal(stored.decisions[0].original_decision_review_date, '2026-08-31');
  } finally {
    cleanup(ctx);
  }
});

test('ACTIVE category TEST item does not use rollout-specific review date on POSTPONE', () => {
  const ctx = createService({ items: [ACTIVE_TEST_ITEM] });
  try {
    const result = ctx.service.saveDecision(RUN_ID, ACTIVE_TEST_ITEM.row_id, {
      decision: 'POSTPONE',
      quantity: null,
    });

    assert.equal(result.item.owner_decision.decision, 'DEFER');
    assert.equal(result.item.owner_decision.original_decision, 'POSTPONE');
    assert.equal(result.item.test_review_date, undefined);
    assert.equal(result.item.owner_decision.review_date, null);

    const stored = JSON.parse(fs.readFileSync(ctx.decisionsPath, 'utf8'));
    assert.equal(stored.decisions[0].original_decision_review_date, null);
    assert.equal(stored.decisions[0].expires_at, '2026-08-31T10:00:00.000Z');
  } finally {
    cleanup(ctx);
  }
});

test('decorateItems exposes original_decision and review_date for postponed rollout items', () => {
  const ctx = createService();
  try {
    ctx.service.saveDecision(RUN_ID, ROW_ID, {
      decision: 'POSTPONE',
      quantity: null,
    });

    const decorated = ctx.service.decorateItems([ROLLOUT_ITEM]);
    const item = decorated[0];

    assert.equal(item.owner_decision.decision, 'DEFER');
    assert.equal(item.owner_decision.original_decision, 'POSTPONE');
    assert.equal(item.owner_decision.review_date, '2026-08-31');
    assert.equal(item.test_review_date, '2026-08-31');
  } finally {
    cleanup(ctx);
  }
});
