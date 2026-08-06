const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  OwnerDecisionError,
  applyOwnerDecisions,
  appendOwnerDecision,
  emptyOwnerDecisionStore,
  loadOwnerDecisions,
} = require('../matrix_builder/owner_decisions');
const {
  DEFAULT_OWNER_REVIEW_POLICY,
  buildOwnerReviewModel,
} = require('../matrix_builder/owner_review_dashboard');
const {
  runOwnerDecisionCli,
} = require('../../../scripts/set-purchasing-owner-decision');

const BUILDER_VERSION = 'miska-matrix-builder-v0.5.3';

function item(overrides = {}) {
  return {
    rowIdentity: 'row-1',
    source_row_number: 1,
    article: 'SKU-1',
    barcode: null,
    internal_product_id: null,
    name: 'Синтетический товар',
    supplier: 'Тестовый поставщик',
    category: 'Корм',
    suggested_role: 'OPTIONAL',
    suggested_priority: 'standard',
    suggested_minimum_shelf_stock: 1,
    suggested_target_stock: 3,
    suggested_maximum_stock: 5,
    suggested_safety_stock: 1,
    suggested_allow_zero_stock: false,
    suggested_policy: {
      priority: 'standard',
      minimum_shelf_stock: 1,
      target_stock: 3,
      maximum_stock: 5,
      safety_stock: 1,
    },
    existing_policy: null,
    approved_policy_conflict: false,
    policy_conflict: false,
    placeholder_difference: false,
    policy_requires_confirmation: false,
    maximum_stock_value: 500,
    inventory_value_review_level: null,
    reason_codes: [],
    manual_review_reasons: [],
    review_queue_memberships: [],
    confidence: 'high',
    evidence: {
      purchase_price: 100,
      strategic_group_matches: [],
      weekly_sales: [],
      supplier_need_qty: 0,
      supplier_recommended_qty: 0,
    },
    data_quality: {
      identity_ambiguous: false,
      stock_policy_status: 'calculated',
      missing_fields: [],
    },
    ...overrides,
  };
}

function draft(sourceItem = item()) {
  return {
    builder_version: BUILDER_VERSION,
    generated_at: '2026-07-20T10:00:00.000Z',
    source: { file: 'synthetic.xlsx', sku_count: 1 },
    items: [sourceItem],
    summary: {
      total_sku: 1,
      roles: {
        CORE: sourceItem.suggested_role === 'CORE' ? 1 : 0,
        IMPORTANT: sourceItem.suggested_role === 'IMPORTANT' ? 1 : 0,
        OPTIONAL: sourceItem.suggested_role === 'OPTIONAL' ? 1 : 0,
        EXIT: sourceItem.suggested_role === 'EXIT' ? 1 : 0,
        UNCLASSIFIED: sourceItem.suggested_role === 'UNCLASSIFIED' ? 1 : 0,
      },
      policy_conflicts: sourceItem.approved_policy_conflict ? 1 : 0,
      approved_policy_conflicts: sourceItem.approved_policy_conflict ? 1 : 0,
    },
  };
}

function decision(ownerDecision, overrides = {}) {
  return {
    sku: 'SKU-1',
    owner_decision: ownerDecision,
    owner_role_override: null,
    owner_policy_override: null,
    reason: 'Решение владельца',
    decided_at: '2026-07-20T10:00:00.000Z',
    decided_by: 'owner',
    status: 'active',
    source_version: BUILDER_VERSION,
    ...overrides,
  };
}

function store(decisions) {
  return {
    version: 1,
    store: 'Миска',
    updated_at: decisions.at(-1)?.decided_at || null,
    decisions,
  };
}

function modelFor(application) {
  return buildOwnerReviewModel(
    application.draft,
    null,
    { owner_review_policy: DEFAULT_OWNER_REVIEW_POLICY },
    application.summary
  );
}

test('active decision is applied and suppresses repeated Owner Action', () => {
  const application = applyOwnerDecisions(draft(), store([decision('KEEP_CORE')]));
  const result = application.draft.items[0];
  assert.equal(result.suggested_role, 'CORE');
  assert.equal(result.owner_decision_applied, true);
  assert.equal(result.owner_decision_status, 'active');
  assert.equal(modelFor(application).summary.owner_action_required_total, 0);
});

test('inactive latest decision is visible but not applied', () => {
  const application = applyOwnerDecisions(draft(), store([
    decision('KEEP_CORE', { status: 'inactive' }),
  ]));
  const result = application.draft.items[0];
  assert.equal(result.suggested_role, 'OPTIONAL');
  assert.equal(result.owner_decision_status, 'inactive');
  assert.equal(result.owner_decision_applied, false);
});

test('latest active decision for a SKU wins deterministically', () => {
  const application = applyOwnerDecisions(draft(), store([
    decision('KEEP_CORE', { decided_at: '2026-07-20T09:00:00.000Z' }),
    decision('KEEP_OPTIONAL', { decided_at: '2026-07-20T10:00:00.000Z' }),
  ]));
  const result = application.draft.items[0];
  assert.equal(result.suggested_role, 'OPTIONAL');
  assert.match(result.owner_decision_summary, /^KEEP_OPTIONAL:/);
});

test('inactive history entry does not displace the latest active decision', () => {
  const application = applyOwnerDecisions(draft(), store([
    decision('KEEP_CORE', { decided_at: '2026-07-20T09:00:00.000Z' }),
    decision('KEEP_OPTIONAL', {
      status: 'inactive',
      decided_at: '2026-07-20T10:00:00.000Z',
    }),
  ]));
  const result = application.draft.items[0];
  assert.equal(result.suggested_role, 'CORE');
  assert.equal(result.owner_decision_status, 'active');
});

test('DEFER remains in Owner Action Required', () => {
  const application = applyOwnerDecisions(draft(), store([decision('DEFER')]));
  const model = modelFor(application);
  assert.equal(application.summary.deferred, 1);
  assert.deepEqual(model.sections.owner_action_required, ['row-1']);
});

test('web order decisions preserve matrix calculations and quantity history', () => {
  const source = draft();
  const buy = applyOwnerDecisions(source, store([
    decision('BUY', { owner_order_quantity: 7 }),
  ]));
  const skip = applyOwnerDecisions(source, store([
    decision('SKIP', { owner_order_quantity: 0 }),
  ]));
  for (const result of [buy.draft.items[0], skip.draft.items[0]]) {
    assert.equal(result.suggested_role, 'OPTIONAL');
    assert.equal(result.suggested_target_stock, 3);
    assert.equal(result.owner_decision_applied, true);
    assert.equal(result.owner_decision_excluded_from_review, true);
  }
  assert.equal(buy.draft.items[0].owner_order_decision, 'BUY');
  assert.equal(buy.draft.items[0].owner_order_quantity, 7);
  assert.equal(skip.draft.items[0].owner_order_decision, 'SKIP');
  assert.equal(skip.draft.items[0].owner_order_quantity, 0);
});

test('APPROVE_EXIT removes confirmed SKU from EXIT Approval', () => {
  const exit = item({
    suggested_role: 'EXIT',
    suggested_allow_zero_stock: true,
    reason_codes: ['possible_exit_candidate'],
    manual_review_reasons: ['possible_exit_candidate'],
    review_queue_memberships: ['exit_review'],
  });
  const application = applyOwnerDecisions(draft(exit), store([decision('APPROVE_EXIT')]));
  const model = modelFor(application);
  assert.equal(application.draft.items[0].owner_exit_approved, true);
  assert.equal(model.summary.exit_approval, 0);
  assert.equal(model.summary.owner_action_required_total, 0);
});

test('APPROVE_EXIT returns to review when fresh calculations no longer support EXIT', () => {
  const application = applyOwnerDecisions(
    draft(item({ suggested_role: 'CORE' })),
    store([decision('APPROVE_EXIT')])
  );
  const result = application.draft.items[0];
  assert.equal(result.suggested_role, 'CORE');
  assert.equal(result.owner_decision_conflict, true);
  assert.deepEqual(modelFor(application).sections.owner_action_required, ['row-1']);
});

test('REJECT_EXIT cancels EXIT and keeps SKU under manual commercial control', () => {
  const exit = item({
    suggested_role: 'EXIT',
    suggested_allow_zero_stock: true,
    review_queue_memberships: ['exit_review'],
  });
  const application = applyOwnerDecisions(draft(exit), store([decision('REJECT_EXIT')]));
  const result = application.draft.items[0];
  const model = modelFor(application);
  assert.equal(result.suggested_role, 'OPTIONAL');
  assert.ok(result.review_queue_memberships.includes('commercial_review'));
  assert.deepEqual(model.sections.owner_action_required, ['row-1']);
});

test('KEEP_CORE overrides the calculated role but preserves it for audit', () => {
  const application = applyOwnerDecisions(draft(), store([decision('KEEP_CORE')]));
  const result = application.draft.items[0];
  assert.equal(result.calculated_role, 'OPTIONAL');
  assert.equal(result.suggested_role, 'CORE');
});

test('ACCEPT_POLICY clears a repeated approved-policy conflict', () => {
  const conflict = item({
    approved_policy_conflict: true,
    policy_conflict: true,
    reason_codes: ['approved_policy_conflict'],
    manual_review_reasons: ['approved_policy_conflict'],
    review_queue_memberships: ['policy_conflict'],
  });
  const application = applyOwnerDecisions(draft(conflict), store([
    decision('ACCEPT_POLICY'),
  ]));
  const result = application.draft.items[0];
  assert.equal(result.approved_policy_conflict, false);
  assert.equal(modelFor(application).summary.approved_conflicts, 0);
});

test('zero-stock decisions override only the review-layer policy', () => {
  const keepZero = applyOwnerDecisions(draft(), store([
    decision('KEEP_ZERO_STOCK'),
  ])).draft.items[0];
  const requireStock = applyOwnerDecisions(
    draft(item({ suggested_allow_zero_stock: true })),
    store([decision('REQUIRE_STOCK')])
  ).draft.items[0];
  assert.equal(keepZero.suggested_allow_zero_stock, true);
  assert.equal(requireStock.suggested_allow_zero_stock, false);
  assert.equal(keepZero.calculated_policy.allow_zero_stock, false);
  assert.equal(requireStock.calculated_policy.allow_zero_stock, true);
});

test('OVERRIDE_POLICY applies an explicit monotonic policy and keeps the baseline', () => {
  const application = applyOwnerDecisions(draft(), store([
    decision('OVERRIDE_POLICY', {
      owner_policy_override: {
        priority: 'important',
        minimum_shelf_stock: 2,
        target_stock: 4,
        maximum_stock: 6,
        safety_stock: 2,
      },
    }),
  ]));
  const result = application.draft.items[0];
  assert.equal(result.suggested_priority, 'important');
  assert.equal(result.suggested_minimum_shelf_stock, 2);
  assert.equal(result.suggested_target_stock, 4);
  assert.equal(result.suggested_maximum_stock, 6);
  assert.equal(result.maximum_stock_value, 600);
  assert.equal(result.calculated_policy.maximum_stock, 5);
});

test('a new strong conflict returns the SKU with OWNER_DECISION_CONFLICT', () => {
  const exit = item({
    suggested_role: 'EXIT',
    review_queue_memberships: ['exit_review'],
  });
  const application = applyOwnerDecisions(draft(exit), store([
    decision('KEEP_CORE', { source_version: 'miska-matrix-builder-v0.5.2' }),
  ]));
  const result = application.draft.items[0];
  const model = modelFor(application);
  assert.equal(result.owner_decision_applied, false);
  assert.equal(result.owner_decision_conflict, true);
  assert.ok(result.reason_codes.includes('OWNER_DECISION_CONFLICT'));
  assert.deepEqual(model.sections.owner_action_required, ['row-1']);
});

test('helper appends history and never removes the previous decision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  appendOwnerDecision(filePath, decision('KEEP_CORE'));
  runOwnerDecisionCli([
    '--file', filePath,
    '--sku', 'SKU-1',
    '--decision', 'KEEP_OPTIONAL',
    '--reason', 'Новое решение',
    '--decided-at', '2026-07-21T10:00:00.000Z',
  ], { output: () => {} });
  const loaded = loadOwnerDecisions(filePath).store;
  assert.equal(loaded.decisions.length, 2);
  assert.equal(loaded.decisions[0].owner_decision, 'KEEP_CORE');
  assert.equal(loaded.decisions[1].owner_decision, 'KEEP_OPTIONAL');
});

test('legacy stored decision without reason_code still loads', () => {
  const directory = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'owner-decisions-legacy-'
  ));
  const filePath = path.join(directory, 'decisions.json');
  fs.writeFileSync(filePath, JSON.stringify(store([
    decision('BUY', { owner_order_quantity: 3 }),
  ])));

  try {
    const loaded = loadOwnerDecisions(filePath).store.decisions[0];
    assert.equal(loaded.owner_decision, 'BUY');
    assert.equal(loaded.owner_order_quantity, 3);
    assert.equal(loaded.reason_code, null);
    assert.equal(loaded.comment, null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unknown owner decision is rejected without writing a record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const filePath = path.join(directory, 'decisions.json');
  assert.throws(
    () => runOwnerDecisionCli([
      '--file', filePath,
      '--sku', 'SKU-1',
      '--decision', 'UNKNOWN',
      '--reason', 'Некорректное решение',
      '--decided-at', '2026-07-20T10:00:00.000Z',
    ], { output: () => {} }),
    error => error instanceof OwnerDecisionError && error.code === 'UNKNOWN_OWNER_DECISION'
  );
  assert.equal(fs.existsSync(filePath), false);
});

test('identical repeated application is stable and does not mutate the draft', () => {
  const sourceDraft = draft();
  const before = structuredClone(sourceDraft);
  const decisions = store([decision('KEEP_CORE')]);
  const first = applyOwnerDecisions(sourceDraft, decisions);
  const second = applyOwnerDecisions(sourceDraft, decisions);
  assert.deepEqual(first, second);
  assert.deepEqual(sourceDraft, before);
});

test('missing decisions file is backward compatible with unchanged calculations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-decisions-'));
  const loaded = loadOwnerDecisions(path.join(directory, 'missing.json'));
  assert.deepEqual(loaded.store, emptyOwnerDecisionStore());
  const sourceDraft = draft();
  const application = applyOwnerDecisions(sourceDraft, loaded.store);
  const effective = application.draft.items[0];
  const calculated = sourceDraft.items[0];
  for (const field of [
    'suggested_role', 'suggested_priority', 'suggested_minimum_shelf_stock',
    'suggested_target_stock', 'suggested_maximum_stock',
    'suggested_safety_stock', 'suggested_allow_zero_stock',
  ]) assert.equal(effective[field], calculated[field]);
  assert.equal(application.summary.records_loaded, 0);
});

test('a duplicated source SKU is never silently overridden', () => {
  const first = item();
  const second = item({ rowIdentity: 'row-2', source_row_number: 2 });
  const sourceDraft = draft(first);
  sourceDraft.items = [first, second];
  sourceDraft.summary.total_sku = 2;
  sourceDraft.summary.roles.OPTIONAL = 2;
  const application = applyOwnerDecisions(
    sourceDraft,
    store([decision('KEEP_CORE')])
  );
  assert.deepEqual(
    application.draft.items.map(entry => entry.suggested_role),
    ['OPTIONAL', 'OPTIONAL']
  );
  assert.deepEqual(application.summary.unmatched_active_skus, ['SKU-1']);
});

test('legacy plain SKU decision still applies for backward compatibility', () => {
  const application = applyOwnerDecisions(draft(), store([decision('KEEP_CORE')]));
  assert.equal(application.draft.items[0].suggested_role, 'CORE');
  assert.equal(application.summary.matched_active_skus, 1);
});

test('supplier-aware decision takes precedence over legacy plain SKU', () => {
  const sourceDraft = draft();
  const application = applyOwnerDecisions(
    sourceDraft,
    store([
      decision('KEEP_CORE', {
        sku: 'SKU-1',
        decided_at: '2026-07-20T09:00:00.000Z',
      }),
      decision('KEEP_OPTIONAL', {
        sku: 'SUPPLIER:ТЕСТОВЫЙ ПОСТАВЩИК:SKU:SKU-1',
        decided_at: '2026-07-20T10:00:00.000Z',
      }),
    ])
  );
  assert.equal(application.draft.items[0].suggested_role, 'OPTIONAL');
});

test('identical SKU at different suppliers does not mix decisions', () => {
  const first = item();
  const second = item({
    rowIdentity: 'row-2',
    source_row_number: 2,
    supplier: 'Другой поставщик',
  });
  const sourceDraft = draft(first);
  sourceDraft.items = [first, second];
  sourceDraft.summary.total_sku = 2;
  sourceDraft.summary.roles.OPTIONAL = 2;

  const application = applyOwnerDecisions(
    sourceDraft,
    store([
      decision('KEEP_CORE', {
        sku: 'SUPPLIER:ТЕСТОВЫЙ ПОСТАВЩИК:SKU:SKU-1',
      }),
    ])
  );

  assert.equal(application.draft.items[0].suggested_role, 'CORE');
  assert.equal(application.draft.items[1].suggested_role, 'OPTIONAL');
});

test('decision persists when row identity changes', () => {
  const original = applyOwnerDecisions(
    draft(),
    store([decision('KEEP_CORE')])
  );
  const reimported = applyOwnerDecisions(
    draft(item({ rowIdentity: 'row-99', source_row_number: 99 })),
    store([decision('KEEP_CORE')])
  );

  assert.equal(original.draft.items[0].suggested_role, 'CORE');
  assert.equal(reimported.draft.items[0].suggested_role, 'CORE');
});

test('decision persists when stock or sales figures change', () => {
  const original = applyOwnerDecisions(
    draft(),
    store([decision('KEEP_CORE')])
  );
  const updated = applyOwnerDecisions(
    draft(item({ evidence: { purchase_price: 200, strategic_group_matches: [], weekly_sales: [], supplier_need_qty: 100, supplier_recommended_qty: 100 } })),
    store([decision('KEEP_CORE')])
  );

  assert.equal(original.draft.items[0].suggested_role, 'CORE');
  assert.equal(updated.draft.items[0].suggested_role, 'CORE');
});

test('decision persists when new SKUs are added', () => {
  const first = item({ article: 'ART-001' });
  const second = item({
    rowIdentity: 'row-2',
    source_row_number: 2,
    article: 'ART-002',
    supplier: 'Другой поставщик',
  });
  const originalDraft = draft(first);
  originalDraft.items = [first];
  originalDraft.summary.total_sku = 1;

  const expandedDraft = draft(first);
  expandedDraft.items = [first, second];
  expandedDraft.summary.total_sku = 2;
  expandedDraft.summary.roles.OPTIONAL = 2;

  const original = applyOwnerDecisions(
    originalDraft,
    store([decision('KEEP_CORE', { sku: 'SUPPLIER:ТЕСТОВЫЙ ПОСТАВЩИК:SKU:ART-001' })])
  );
  const expanded = applyOwnerDecisions(
    expandedDraft,
    store([decision('KEEP_CORE', { sku: 'SUPPLIER:ТЕСТОВЫЙ ПОСТАВЩИК:SKU:ART-001' })])
  );

  assert.equal(original.draft.items[0].suggested_role, 'CORE');
  assert.equal(expanded.draft.items[0].suggested_role, 'CORE');
  assert.equal(expanded.draft.items[1].suggested_role, 'OPTIONAL');
});

test('fallback brand-name decision applies when article is missing', () => {
  const sourceItem = item({ article: null, barcode: null, brand: 'Миска' });
  const sourceDraft = draft(sourceItem);
  const application = applyOwnerDecisions(
    sourceDraft,
    store([
      decision('KEEP_CORE', {
        sku: 'SUPPLIER:ТЕСТОВЫЙ ПОСТАВЩИК:FALLBACK:МИСКА|СИНТЕТИЧЕСКИЙ ТОВАР',
      }),
    ])
  );

  assert.equal(application.draft.items[0].suggested_role, 'CORE');
  assert.equal(application.summary.matched_active_skus, 1);
});
