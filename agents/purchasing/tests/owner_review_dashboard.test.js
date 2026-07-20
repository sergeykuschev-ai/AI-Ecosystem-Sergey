const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  DEFAULT_OWNER_REVIEW_POLICY,
  buildOwnerReviewModel,
  buildOwnerReviewReport,
  scoreOwnerReviewItem,
  selectTopPriorityItems,
} = require('../matrix_builder/owner_review_dashboard');
const {
  validateMatrixBuilderConfig,
} = require('../matrix_builder/matrix_builder_validator');

function dashboardItem(index, overrides = {}) {
  return {
    rowIdentity: `row-${index}`,
    source_row_number: index,
    article: `SKU-${index}`,
    name: `Синтетический товар ${index}`,
    category: 'Синтетическая категория',
    suggested_role: 'OPTIONAL',
    suggested_priority: 'standard',
    suggested_minimum_shelf_stock: 1,
    suggested_target_stock: 3,
    suggested_maximum_stock: 5,
    suggested_safety_stock: 1,
    existing_matrix_item: false,
    existing_policy: null,
    suggested_policy: {
      priority: 'standard',
      minimum_shelf_stock: 1,
      target_stock: 3,
      maximum_stock: 5,
    },
    approved_policy_conflict: false,
    placeholder_difference: false,
    policy_requires_confirmation: false,
    maximum_stock_value: 500,
    inventory_value_review_level: null,
    review_queue_memberships: [],
    manual_review_reasons: [],
    reason_codes: ['stable_sales'],
    explanation: 'Стабильные продажи на завершённых неделях.',
    confidence: 'high',
    evidence: {
      weekly_sales: [],
      short_average: 1,
      base_average: 1,
      preferred_average: 1,
      long_term_average: 1,
      effective_average: 1,
      total_completed_weeks_available: 26,
      lead_time_weeks: 1,
      supplier_need_qty: 0,
      supplier_recommended_qty: 0,
      purchase_price: 100,
      strategic_group_matches: [],
      policy_formula: { maximum_stock: 'synthetic maximum formula' },
      exit_evaluation: null,
    },
    data_quality: {
      identity_ambiguous: false,
      stock_policy_status: 'calculated',
      missing_fields: [],
    },
    validation: { errors: [], warnings: [] },
    ...overrides,
  };
}

function dashboardDraft(items) {
  return {
    generated_at: '2026-07-20T10:00:00.000Z',
    source: {
      file: 'synthetic.xlsx',
      report_timestamp: '2026-07-19T06:00:00.000Z',
    },
    config: {
      stock_policy: { target_cover_weeks: 2, maximum_cover_weeks: 4 },
    },
    items,
    summary: {
      total_sku: items.length,
      roles: {
        CORE: items.filter(item => item.suggested_role === 'CORE').length,
        OPTIONAL: items.filter(item => item.suggested_role === 'OPTIONAL').length,
        EXIT: items.filter(item => item.suggested_role === 'EXIT').length,
        UNCLASSIFIED: items.filter(item => item.suggested_role === 'UNCLASSIFIED').length,
      },
      priorities: {
        important: items.filter(item => item.suggested_priority === 'important').length,
      },
      manual_review: items.filter(item => item.review_queue_memberships.length > 0).length,
    },
  };
}

function config(overrides = {}) {
  return {
    owner_review_policy: {
      ...DEFAULT_OWNER_REVIEW_POLICY,
      ...overrides,
    },
  };
}

function exitItem(index = 1, overrides = {}) {
  return dashboardItem(index, {
    suggested_role: 'EXIT',
    suggested_priority: 'review',
    review_queue_memberships: ['exit_review'],
    manual_review_reasons: ['exit_no_sales_8_weeks'],
    reason_codes: ['exit_no_sales_8_weeks'],
    confidence: 'medium',
    evidence: {
      ...dashboardItem(index).evidence,
      short_average: 0,
      base_average: 0,
      preferred_average: 0,
      long_term_average: 0,
      effective_average: 0,
      exit_evaluation: {
        horizonWeeks: 8,
        currentWeekSale: false,
        strategicProtected: false,
      },
    },
    ...overrides,
  });
}

test('owner_review_policy configuration is validated', () => {
  const source = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../../data/purchasing/miska-matrix-builder-config.json'
  ), 'utf8'));
  const validated = validateMatrixBuilderConfig(source);
  assert.equal(validated.owner_review_policy.max_owner_action_items, 30);
  assert.equal(validated.owner_review_policy.critical_inventory_score, 80);
  const invalid = structuredClone(source);
  invalid.owner_review_policy.identity_only_score = 0;
  assert.throws(() => validateMatrixBuilderConfig(invalid), /identity_only_score/);
});

test('owner report is generated with every required management section', () => {
  const core = dashboardItem(1, { suggested_role: 'CORE' });
  const exit = exitItem(2);
  const report = buildOwnerReviewReport(
    dashboardDraft([core, exit]),
    null,
    config()
  );
  for (const heading of [
    'EXECUTIVE SUMMARY', 'OWNER ACTION REQUIRED', 'CORE REVIEW',
    'EXIT APPROVAL', 'LARGE INVENTORY REVIEW', 'POLICY REVIEW',
    'COMMERCIAL REVIEW', 'DATA QUALITY', 'OWNER DECISION SHEET',
  ]) assert.ok(report.includes(heading), `Нет раздела ${heading}`);
  assert.ok(report.includes('# Owner Review — ассортиментная матрица «Миска»'));
  assert.ok(report.includes('Синтетический товар 1'));
  assert.ok(report.includes('□ Утвердить EXIT'));
});

test('building owner artifacts does not mutate Matrix Builder calculations', () => {
  const draft = dashboardDraft([dashboardItem(1), exitItem(2)]);
  const before = structuredClone(draft);
  const model = buildOwnerReviewModel(draft, null, config());
  buildOwnerReviewReport(draft, null, config(), model);
  assert.deepEqual(draft, before);
});

test('Owner Action Required is limited by configured maximum of 30 SKU', () => {
  const items = Array.from({ length: 35 }, (_, index) => dashboardItem(index + 1, {
    review_queue_memberships: ['commercial_review'],
    reason_codes: ['short_long_trend_conflict'],
  }));
  assert.equal(selectTopPriorityItems(items, config().owner_review_policy).length, 30);
});

test('approved conflict has maximum display priority', () => {
  const commercial = dashboardItem(1, {
    review_queue_memberships: ['commercial_review'],
  });
  const conflict = dashboardItem(2, {
    approved_policy_conflict: true,
    review_queue_memberships: ['policy_conflict'],
    reason_codes: ['approved_policy_conflict'],
  });
  const model = buildOwnerReviewModel(
    dashboardDraft([commercial, conflict]),
    null,
    config()
  );
  assert.equal(model.sections.owner_action_required[0], conflict.rowIdentity);
  assert.equal(
    model.items.find(item => item.rowIdentity === conflict.rowIdentity).owner_review_priority,
    'P1'
  );
});

test('critical inventory score is higher than ordinary large inventory', () => {
  const large = dashboardItem(1, {
    review_queue_memberships: ['large_inventory_review'],
    inventory_value_review_level: 'review',
  });
  const critical = dashboardItem(2, {
    review_queue_memberships: ['large_inventory_review'],
    inventory_value_review_level: 'critical',
  });
  assert.ok(
    scoreOwnerReviewItem(critical).owner_review_score >
      scoreOwnerReviewItem(large).owner_review_score
  );
});

test('identity-only issue cannot displace a commercial risk', () => {
  const identity = dashboardItem(1, {
    review_queue_memberships: ['identity_remediation'],
    reason_codes: ['ambiguous_identity'],
  });
  const commercial = dashboardItem(2, {
    review_queue_memberships: ['commercial_review'],
    reason_codes: ['short_long_trend_conflict'],
  });
  const policy = { ...DEFAULT_OWNER_REVIEW_POLICY, max_owner_action_items: 1 };
  const selected = selectTopPriorityItems([identity, commercial], policy);
  assert.deepEqual(selected.map(item => item.rowIdentity), [commercial.rowIdentity]);
});

test('one SKU is not duplicated in Owner Decision Sheet', () => {
  const combined = exitItem(1, {
    approved_policy_conflict: true,
    inventory_value_review_level: 'critical',
    review_queue_memberships: [
      'exit_review', 'policy_conflict', 'large_inventory_review',
    ],
  });
  const model = buildOwnerReviewModel(dashboardDraft([combined]), null, config());
  assert.deepEqual(model.sections.owner_decision_sheet, [combined.rowIdentity]);
});

test('every EXIT candidate is present in EXIT Approval', () => {
  const exits = [exitItem(1), exitItem(2), exitItem(3)];
  const model = buildOwnerReviewModel(dashboardDraft(exits), null, config());
  assert.deepEqual(
    new Set(model.sections.exit_approval),
    new Set(exits.map(item => item.rowIdentity))
  );
});

test('placeholder difference is separate from approved conflict', () => {
  const placeholder = dashboardItem(1, {
    placeholder_difference: true,
    existing_matrix_item: true,
    existing_policy: {
      policy_status: 'placeholder', priority: 'standard',
      minimum_shelf_stock: 0, target_stock: 0,
    },
  });
  const model = buildOwnerReviewModel(dashboardDraft([placeholder]), null, config());
  assert.equal(model.summary.placeholder_differences, 1);
  assert.equal(model.summary.approved_conflicts, 0);
});

test('missing purchase price is displayed as «нет данных», never zero', () => {
  const missingPrice = dashboardItem(1, {
    maximum_stock_value: null,
    inventory_value_review_level: null,
    review_queue_memberships: ['large_inventory_review', 'insufficient_data'],
    reason_codes: ['missing_purchase_price', 'large_inventory_units'],
    evidence: {
      ...dashboardItem(1).evidence,
      purchase_price: null,
    },
  });
  const report = buildOwnerReviewReport(
    dashboardDraft([missingPrice]), null, config()
  );
  const largeSection = report.split('## 6. 💰 LARGE INVENTORY REVIEW')[1]
    .split('## 7. 🛡️ POLICY REVIEW')[0];
  assert.ok(largeSection.includes('нет данных'));
  assert.ok(!largeSection.includes('| 0 ₽ |'));
});

test('owner report and JSON model are stable for identical input', () => {
  const draft = dashboardDraft([dashboardItem(1), exitItem(2)]);
  const firstModel = buildOwnerReviewModel(draft, null, config());
  const secondModel = buildOwnerReviewModel(draft, null, config());
  assert.deepEqual(firstModel, secondModel);
  assert.equal(
    buildOwnerReviewReport(draft, null, config(), firstModel),
    buildOwnerReviewReport(draft, null, config(), secondModel)
  );
});
