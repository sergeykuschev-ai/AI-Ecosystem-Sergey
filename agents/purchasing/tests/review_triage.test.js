'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRIAGE_CATEGORIES,
  SEVERITY,
  triageReviewQueue,
} = require('../review_triage/review_triage');
const {
  explainTriage,
  detectContradictions,
} = require('../review_triage/review_triage_explainer');

function draftItem(overrides = {}) {
  return {
    rowIdentity: overrides.rowIdentity || 'row-1',
    source_row_number: 1,
    article: overrides.article || 'ART-1',
    name: overrides.name || 'Товар тестовый',
    supplier: overrides.supplier ?? 'ООО Поставщик',
    category: overrides.category || 'Корма',
    suggested_role: overrides.suggested_role ?? 'CORE',
    manual_review_required: true,
    review_queue_memberships: overrides.review_queue_memberships || ['insufficient_data'],
    manual_review_reasons: overrides.manual_review_reasons || [],
    reason_codes: overrides.reason_codes || [],
    evidence: {
      free_stock: 'free_stock' in overrides ? overrides.free_stock : 5,
      purchase_price: 'purchase_price' in overrides ? overrides.purchase_price : 100,
      supplier_need_qty: 1,
      supplier_recommended_qty: 1,
      ...(overrides.evidence || {}),
    },
    data_quality: {
      confidence: 'high',
      identity_ambiguous: false,
      stock_policy_status: 'calculated',
      missing_fields: overrides.missing_fields || [],
    },
    ...(overrides.extra || {}),
  };
}

function workProduct(overrides = {}) {
  return {
    rowIdentity: overrides.rowIdentity || 'row-1',
    name: 'Товар тестовый',
    article: overrides.article || 'ART-1',
    supplier: 'ООО Поставщик',
    workflowStatus: overrides.workflowStatus || 'pending_manual_review',
    approvedOrderQuantity: 'approvedOrderQuantity' in overrides ? overrides.approvedOrderQuantity : 0,
    provisionalOrderQuantity: 'provisionalOrderQuantity' in overrides ? overrides.provisionalOrderQuantity : 2,
    finalRecommendedQuantity: 'finalRecommendedQuantity' in overrides ? overrides.finalRecommendedQuantity : 2,
    minmaxRecommendedQuantity: 'minmaxRecommendedQuantity' in overrides ? overrides.minmaxRecommendedQuantity : 2,
    analyzerCalculatedQuantity: 'analyzerCalculatedQuantity' in overrides ? overrides.analyzerCalculatedQuantity : 2,
    priceNum: 'priceNum' in overrides ? overrides.priceNum : 100,
    blockingReason: overrides.blockingReason ?? null,
    decisionReasons: overrides.decisionReasons || [],
    requiredData: overrides.requiredData || [],
    freeStock: 'freeStock' in overrides ? overrides.freeStock : 5,
    assortment_matrix: { matched: true },
    rolloutStatus: overrides.rolloutStatus,
    ...(overrides.extra || {}),
  };
}

function bundle({ drafts = [], products = [], agentJson = {}, ownerReview = {} }) {
  return {
    runId: 'run-test-1',
    agentJson: {
      workingOrderVersion: 'v2-test',
      decisionVersion: 'phase2-test',
      workingOrderProducts: products,
      adapter_diagnostics: { duplicateIdentifiers: [] },
      ...agentJson,
    },
    manualReview: {
      version: 1,
      status: 'draft_manual_review_queue',
      item_count: drafts.length,
      items: drafts,
      review_queues: {},
    },
    ownerReview: {
      version: 1,
      items: [],
      sections: {},
      ...ownerReview,
    },
  };
}

function singleItemTriage(build) {
  const input = build();
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  assert.equal(triage.items.length, 1);
  return { triage, item: triage.items[0] };
}

test('настоящий нулевой остаток не считается неизвестным', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({ rowIdentity: 'r-zero', article: 'Z-1', free_stock: 0 })],
    products: [workProduct({ rowIdentity: 'r-zero', article: 'Z-1', freeStock: 0 })],
  }));
  assert.notEqual(item.reason_code, TRIAGE_CATEGORIES.DATA_ERROR_UNKNOWN_STOCK);
  assert.ok(!item.evidence.some(line => line === 'free_stock=unknown'));
  assert.ok(item.evidence.includes('free_stock=0'));
});

test('NULL/пустой/неизвестный остаток → DATA_ERROR_UNKNOWN_STOCK, blocking', () => {
  const { triage, item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-null',
      article: 'N-1',
      free_stock: null,
      missing_fields: ['free_stock'],
      reason_codes: ['missing_inventory_data'],
    })],
    products: [workProduct({
      rowIdentity: 'r-null',
      article: 'N-1',
      freeStock: null,
      blockingReason: 'free_stock_unknown',
      requiredData: ['free_stock'],
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.DATA_ERROR_UNKNOWN_STOCK);
  assert.equal(item.severity, SEVERITY.BLOCKING);
  assert.equal(item.requires_owner_decision, false);
  assert.equal(
    triage.sections.data_problems.items[0].supplier_sku,
    'N-1'
  );
  assert.ok(item.evidence.includes('free_stock=unknown'));
});

test('корректно сопоставленный canonical SKU не попадает в MATRIX_UNMATCHED', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-matched',
      article: 'M-1',
      extra: { existing_matrix_item: true },
    })],
    products: [workProduct({
      rowIdentity: 'r-matched',
      article: 'M-1',
      assortment_matrix: { matched: true },
    })],
  }));
  assert.notEqual(item.reason_code, TRIAGE_CATEGORIES.MATRIX_UNMATCHED);
});

test('товар без правила матрицы → MATRIX_UNMATCHED', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-unmatched',
      article: 'U-1',
      extra: { existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-unmatched',
      article: 'U-1',
      assortment_matrix: { matched: false },
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.MATRIX_UNMATCHED);
  assert.equal(item.requires_owner_decision, false);
});

test('отсутствующая цена поставщика → SUPPLIER_DATA_MISSING', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-noprice',
      article: 'P-1',
      purchase_price: null,
      reason_codes: ['missing_purchase_price'],
    })],
    products: [workProduct({ rowIdentity: 'r-noprice', article: 'P-1', priceNum: null })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING);
  assert.equal(item.severity, SEVERITY.BLOCKING);
  assert.ok(item.evidence.some(line => line.includes('purchase_price')));
});


test('missing supplier delivery cycle wins over MATRIX_UNMATCHED', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-cycle',
      article: 'CYCLE-1',
      supplier: 'Хабаровск ОПТ',
      extra: { existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-cycle',
      article: 'CYCLE-1',
      blockingReason: 'incomplete_demand_data',
      requiredData: ['supplier_delivery_cycle_days'],
      assortment_matrix: { matched: false },
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING);
  assert.equal(item.severity, SEVERITY.BLOCKING);
});

test('sales-spike blocker wins over MATRIX_UNMATCHED', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-spike-blocker',
      article: 'SPIKE-BLOCKER-1',
      extra: { existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-spike-blocker',
      article: 'SPIKE-BLOCKER-1',
      blockingReason: 'sales_spike_quantity_requires_review',
      decisionReasons: ['sales_spike_quantity_requires_review'],
      assortment_matrix: { matched: false },
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SALES_SPIKE_REVIEW);
  assert.equal(item.severity, SEVERITY.WARNING);
});

test('short/long demand trend conflict wins over MATRIX_UNMATCHED', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-trend',
      article: 'TREND-1',
      extra: { existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-trend',
      article: 'TREND-1',
      blockingReason: 'short_long_trend_conflict',
      decisionReasons: ['short_long_trend_conflict'],
      assortment_matrix: { matched: false },
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED);
  assert.equal(item.severity, SEVERITY.WARNING);
});

test('дубль артикула → DUPLICATE_SKU', () => {
  const input = bundle({
    drafts: [
      draftItem({ rowIdentity: 'r-dup-a', article: 'D-1' }),
      draftItem({ rowIdentity: 'r-dup-b', article: 'D-1', extra: {} }),
    ],
    products: [
      workProduct({ rowIdentity: 'r-dup-a', article: 'D-1' }),
      workProduct({ rowIdentity: 'r-dup-b', article: 'D-1' }),
    ],
    agentJson: {
      adapter_diagnostics: {
        duplicateIdentifiers: [{
          identifierType: 'article',
          value: 'D-1',
          rowNumbers: [1, 2],
          rowIdentities: ['r-dup-a', 'r-dup-b'],
        }],
      },
    },
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  assert.equal(triage.items.length, 2);
  for (const item of triage.items) {
    assert.equal(item.reason_code, TRIAGE_CATEGORIES.DUPLICATE_SKU);
  }
  assert.ok(
    triage.items[0].evidence.some(line => line.startsWith('duplicate_article=D-1'))
  );
});

test('новый TEST SKU без истории продаж → NEW_SKU_REVIEW без фиктивного спроса', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-new',
      article: 'T-1',
      suggested_role: 'TEST',
      review_queue_memberships: ['test_awaiting_introduction'],
      reason_codes: ['insufficient_sales_history'],
      extra: {
        first_rollout_test_awaiting: true,
        rollout_status: 'FIRST_ROLLOUT',
        suggested_policy: {
          minimum_shelf_stock: 1,
          target_stock: 2,
          maximum_stock: 4,
        },
      },
    })],
    products: [workProduct({
      rowIdentity: 'r-new',
      article: 'T-1',
      rolloutStatus: 'FIRST_ROLLOUT',
      finalRecommendedQuantity: null,
      analyzerCalculatedQuantity: null,
      provisionalOrderQuantity: null,
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.NEW_SKU_REVIEW);
  assert.ok(
    item.evidence.some(line => line.startsWith('suggested_policy: min=1')),
    'утверждённое правило TEST должно быть показано'
  );
  assert.equal(item.line_value, null, 'фиктивный спрос не подставляется');
});

test('SALES_SPIKE → SALES_SPIKE_REVIEW', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-spike',
      article: 'S-1',
      reason_codes: ['irregular_sales'],
    })],
    products: [workProduct({
      rowIdentity: 'r-spike',
      article: 'S-1',
      decisionReasons: ['sales_spike_quantity_requires_review'],
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SALES_SPIKE_REVIEW);
});

test('финансовое ограничение → FINANCIAL_LIMIT_REVIEW', () => {
  const { item } = singleItemTriage(() => bundle({
    agentJson: { financial_assessment: { status: 'MANUAL_APPROVAL_REQUIRED' } },
    drafts: [draftItem({ rowIdentity: 'r-fin', article: 'F-1' })],
    products: [workProduct({
      rowIdentity: 'r-fin',
      article: 'F-1',
      approvedOrderQuantity: 0,
      finalRecommendedQuantity: 5,
      analyzerCalculatedQuantity: 5,
      priceNum: 500,
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.FINANCIAL_LIMIT_REVIEW);
  assert.equal(item.requires_owner_decision, true);
  assert.ok(item.evidence.some(line => line.startsWith('pre_financial_value=2500')));
});

test('EXIT-кандидат → OWNER_DECISION_REQUIRED', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-exit',
      article: 'E-1',
      suggested_role: 'EXIT',
      review_queue_memberships: ['exit_review'],
    })],
    products: [workProduct({ rowIdentity: 'r-exit', article: 'E-1', workflowStatus: 'pending_manual_review' })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
});

test('недоступность Kimi/OmniRoute: детерминированный fallback, классификация не меняется', async () => {
  const input = bundle({
    drafts: [
      draftItem({ rowIdentity: 'r-1', article: 'A-1', free_stock: null, missing_fields: ['free_stock'] }),
      draftItem({ rowIdentity: 'r-2', article: 'A-2', extra: { existing_matrix_item: false } }),
    ],
    products: [
      workProduct({ rowIdentity: 'r-1', article: 'A-1', freeStock: null, requiredData: ['free_stock'], blockingReason: 'free_stock_unknown' }),
      workProduct({ rowIdentity: 'r-2', article: 'A-2', assortment_matrix: { matched: false } }),
    ],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });

  const failingProvider = {
    async generate() {
      const error = new Error('provider down');
      error.code = 'OMNIROUTE_REQUEST_FAILED';
      throw error;
    },
  };

  const withoutProvider = await explainTriage(triage, { bundle: input });
  assert.equal(withoutProvider.ai_available, false);
  assert.ok(withoutProvider.summary.length > 0);

  const withFailingProvider = await explainTriage(triage, {
    bundle: input,
    provider: failingProvider,
  });
  assert.equal(withFailingProvider.ai_available, false);
  assert.equal(withFailingProvider.ai_error, 'OMNIROUTE_REQUEST_FAILED');
  assert.ok(withFailingProvider.summary.length > 0);
  assert.deepEqual(
    withFailingProvider.section_narratives ? Object.keys(withFailingProvider.section_narratives) : [],
    ['ready', 'data_problems', 'matrix_gaps', 'owner_decisions']
  );

  // Классификация идентична при включённом и отключённом ИИ.
  const triageAgain = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  assert.deepEqual(triageAgain.items, triage.items);
  assert.equal(
    triage.items.find(entry => entry.supplier_sku === 'A-1').reason_code,
    TRIAGE_CATEGORIES.DATA_ERROR_UNKNOWN_STOCK
  );
});

test('работающий провайдер даёт AI-сводку, не меняя поля позиций', async () => {
  const input = bundle({
    drafts: [draftItem({ rowIdentity: 'r-ok', article: 'OK-1' })],
    products: [workProduct({ rowIdentity: 'r-ok', article: 'OK-1' })],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  const okProvider = {
    async generate(prompt) {
      assert.ok(prompt.includes('Ты — помощник закупщика'));
      return 'Краткая сводка от провайдера.';
    },
  };
  const explained = await explainTriage(triage, { bundle: input, provider: okProvider });
  assert.equal(explained.ai_available, true);
  assert.equal(explained.summary, 'Краткая сводка от провайдера.');
  assert.ok(Array.isArray(explained.contradictions));
});

test('сводка до/после: owner-очередь сокращается за счёт проблем данных и матрицы', () => {
  const input = bundle({
    drafts: [
      draftItem({ rowIdentity: 'r-stock', article: 'B-1', free_stock: null, missing_fields: ['free_stock'] }),
      draftItem({ rowIdentity: 'r-matrix', article: 'B-2', extra: { existing_matrix_item: false } }),
      draftItem({ rowIdentity: 'r-owner', article: 'B-3', suggested_role: 'EXIT', review_queue_memberships: ['exit_review'] }),
      draftItem({ rowIdentity: 'r-ready', article: 'B-4', review_queue_memberships: [] }),
    ],
    products: [
      workProduct({ rowIdentity: 'r-stock', article: 'B-1', freeStock: null, requiredData: ['free_stock'], blockingReason: 'free_stock_unknown' }),
      workProduct({ rowIdentity: 'r-matrix', article: 'B-2', assortment_matrix: { matched: false } }),
      workProduct({ rowIdentity: 'r-owner', article: 'B-3' }),
      workProduct({ rowIdentity: 'r-ready', article: 'B-4' }),
    ],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  const { comparison } = triage;
  assert.equal(comparison.manual_queue_total_before, 4);
  assert.equal(comparison.real_owner_decisions_after, 1);
  assert.equal(comparison.data_problems, 1);
  assert.equal(comparison.matrix_gaps, 1);
  assert.equal(comparison.moved_out_of_owner_queue, 3);
  assert.equal(comparison.ready, 1);
});

test('несопоставленные позиции матрицы попадают в triage отдельными записями', () => {
  const input = bundle({
    agentJson: {
      missing_matrix_items: [{ article: 'MX-1', name: 'Матричный товар', priority: 'critical', reason: 'not_found_in_supplier_report' }],
      supplier_unassigned_matrix_items: [{ article: 'MX-2', name: 'Без поставщика', priority: 'important', reason: 'supplier_unassigned' }],
      out_of_scope_matrix_items: [{ article: 'MX-3', name: 'Вне отчёта', priority: 'standard', reason: 'out_of_scope_for_supplier_report' }],
    },
    drafts: [],
    products: [],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  assert.equal(triage.items.length, 3);
  const codes = triage.items.map(item => item.reason_code);
  assert.ok(codes.includes(TRIAGE_CATEGORIES.MATRIX_UNMATCHED));
  assert.ok(codes.includes(TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING));
  assert.ok(triage.items.every(item => item.row_identity === null));
});

test('детектор противоречий: дубли в диагностике без DUPLICATE_SKU', () => {
  const input = bundle({
    agentJson: {
      adapter_diagnostics: {
        duplicateIdentifiers: [{
          identifierType: 'article',
          value: 'X-9',
          rowNumbers: [7],
          rowIdentities: ['not-in-queue'],
        }],
      },
    },
    drafts: [draftItem({ rowIdentity: 'r-ok', article: 'B-4' })],
    products: [workProduct({ rowIdentity: 'r-ok', article: 'B-4' })],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  const contradictions = detectContradictions(triage, input);
  assert.ok(contradictions.some(line => line.includes('DUPLICATE_SKU')));
});

test('неизвестный остаток никогда не превращается в ноль в line_value', () => {
  const input = bundle({
    drafts: [draftItem({
      rowIdentity: 'r-val',
      article: 'V-1',
      free_stock: null,
      missing_fields: ['free_stock'],
      purchase_price: null,
    })],
    products: [workProduct({
      rowIdentity: 'r-val',
      article: 'V-1',
      freeStock: null,
      priceNum: null,
      requiredData: ['free_stock'],
      blockingReason: 'free_stock_unknown',
      provisionalOrderQuantity: null,
    })],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-05T00:00:00.000Z' });
  const item = triage.items[0];
  assert.equal(item.line_value, null);
  assert.equal(triage.sections.data_problems.sum_is_partial, true);
});

function ownerReviewEntry(overrides = {}) {
  return {
    rowIdentity: overrides.rowIdentity || 'row-1',
    article: overrides.article || 'ART-1',
    owner_review_reasons: overrides.owner_review_reasons || [],
    owner_action_required: overrides.owner_action_required ?? false,
    owner_action_class: overrides.owner_action_class ?? 'WARNING_ONLY',
    recommended_action: overrides.recommended_action ?? null,
    owner_decision_conflict: overrides.owner_decision_conflict ?? false,
    ...(overrides.extra || {}),
  };
}

test('SALES_SPIKE + настоящий owner business signal: reason сохраняется, owner=true', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-spike-owner',
      article: 'SO-1',
      reason_codes: ['irregular_sales'],
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({
      rowIdentity: 'r-spike-owner',
      article: 'SO-1',
      decisionReasons: ['sales_spike_quantity_requires_review'],
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-spike-owner',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SALES_SPIKE_REVIEW);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
  assert.ok(item.owner_signals.includes('approved_policy_conflict'));
});

test('SUPPLIER_DATA_MISSING + настоящий независимый owner business signal → reason сохраняется, owner=true', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-data-owner',
      article: 'DO-1',
      evidence: { supplier_need_qty: null, supplier_recommended_qty: null },
      extra: { owner_decision_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-data-owner', article: 'DO-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-data-owner',
        owner_review_reasons: ['owner_decision_conflict'],
        owner_decision_conflict: true,
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
});

test('UNKNOWN_STOCK + owner warning, являющийся следствием unknown stock → owner=false', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-stock-warn',
      article: 'SW-1',
      free_stock: null,
      missing_fields: ['free_stock'],
      reason_codes: ['missing_inventory_data'],
    })],
    products: [workProduct({
      rowIdentity: 'r-stock-warn',
      article: 'SW-1',
      freeStock: null,
      blockingReason: 'free_stock_unknown',
      requiredData: ['free_stock'],
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-stock-warn',
        owner_review_reasons: ['insufficient_data'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.DATA_ERROR_UNKNOWN_STOCK);
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.section, 'data_problems');
  assert.deepEqual(item.owner_signals, []);
});

test('обычный SALES_SPIKE без owner business signal → owner=false', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-spike-plain',
      article: 'SP-1',
      reason_codes: ['irregular_sales'],
    })],
    products: [workProduct({
      rowIdentity: 'r-spike-plain',
      article: 'SP-1',
      decisionReasons: ['sales_spike_quantity_requires_review'],
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-spike-plain',
        owner_review_reasons: ['insufficient_data'],
        owner_action_required: false,
        owner_action_class: 'WARNING_ONLY',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SALES_SPIKE_REVIEW);
  assert.equal(item.requires_owner_decision, false);
});

test('чистый owner policy conflict → OWNER_DECISION_REQUIRED, owner=true', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-policy', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
        recommended_action: 'проверить minimum/target/maximum',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
});

test('применённое решение владельца без конфликта гасит остаточные draft-сигналы → owner=false', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-resolved',
      article: 'RS-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-resolved', article: 'RS-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-resolved',
        owner_review_reasons: ['owner_decision_applied'],
        owner_action_required: false,
        owner_action_class: 'RESOLVED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.section, 'ready');
});

test('SAFE_NO_ORDER без необходимости выбора владельца → owner=false', () => {  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-safe',
      article: 'SN-1',
      review_queue_memberships: ['commercial_review'],
    })],
    products: [workProduct({
      rowIdentity: 'r-safe',
      article: 'SN-1',
      workflowStatus: 'no_order_action',
      provisionalOrderQuantity: null,
      finalRecommendedQuantity: null,
      minmaxRecommendedQuantity: null,
      analyzerCalculatedQuantity: null,
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-safe',
        owner_review_reasons: ['commercial_review'],
        owner_action_required: true,
        owner_action_class: 'SAFE_NO_ORDER',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.section, 'ready');
});

test('POSTPONED без необходимости выбора владельца → owner=false', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-post',
      article: 'PO-1',
      review_queue_memberships: ['commercial_review'],
    })],
    products: [workProduct({
      rowIdentity: 'r-post',
      article: 'PO-1',
      workflowStatus: 'postponed',
      provisionalOrderQuantity: null,
      finalRecommendedQuantity: null,
      minmaxRecommendedQuantity: null,
      analyzerCalculatedQuantity: null,
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-post',
        owner_review_reasons: ['commercial_review'],
        owner_action_required: true,
        owner_action_class: 'POSTPONED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, false);
});

test('source_run_id читается из run-metadata.json рядом с артефактами', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-run-meta-'));
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify([{ json: { workingOrderVersion: 'v-test' } }]));
  fs.writeFileSync(path.join(dir, 'manual-review.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, 'owner-review.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, 'run-metadata.json'), JSON.stringify({
    version: 1,
    run_id: 'real-run-id-123',
    generated_at: '2026-09-05T00:00:00.000Z',
    status: 'completed',
  }));
  try {
    const { execFileSync } = require('node:child_process');
    const output = execFileSync(process.execPath, [
      'scripts/triage-purchasing-review.js',
      '--run-dir', dir,
    ], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
    assert.ok(output.includes('real-run-id-123'), output);
    assert.ok(!output.includes('Run: artifacts'), output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- POLICY A: verified owner-approved canonical policy ----------

const VERIFIED_SESSION = 'owner-review-2026-08-19';

function canonicalMatrixBundle(overrides = {}, ruleChangedBy = VERIFIED_SESSION) {
  const base = bundle(overrides);
  base.canonicalMatrix = {
    items: [{
      supplier_sku: 'PC-1',
      sku_id: 'SKU-CANON-1',
      min_stock: 3,
      target_stock: 4,
      max_stock: 5,
      rule_changed_by: ruleChangedBy,
      rule_changed_at: '2026-08-19T00:00:00.000Z',
    }],
  };
  base.ownerReviewSessions = [{
    session_id: VERIFIED_SESSION,
    verified_at: '2026-08-19',
    verified_by: 'owner-review-control-file',
    control_artifact_path: 'data/purchasing/Миска_Туалет_Гигиена_Поведение_v6_OWNER_REVIEW_ФИНАЛЬНЫЙ_КОНТРОЛЬ_19.08.2026.xlsx',
  }];
  return base;
}

test('POLICY A: verified owner canonical + только policy window conflict → owner=false', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-a',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-policy-a', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-a',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, false);
  assert.notEqual(item.section, 'owner_decisions');
  assert.ok(item.owner_signals.includes('approved_policy_conflict'), 'сигнал сохраняется для трассировки');
  assert.ok(item.evidence.includes(`policy_provenance=${VERIFIED_SESSION}`));
  assert.ok(item.evidence.includes('policy_window_conflict=auto_resolved'));
  assert.ok(item.recommended_action.includes('утверждённую owner-политику'));
});

test('POLICY A: policy conflict без доказанной provenance (rule_changed_by=OWNER) → owner=true', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-no-prov',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-policy-no-prov', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-no-prov',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }, 'OWNER'));
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
  assert.ok(!item.evidence.includes(`policy_provenance=${VERIFIED_SESSION}`));
});

test('POLICY A: policy conflict без canonical matrix в bundle → owner=true', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-no-matrix',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-policy-no-matrix', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-no-matrix',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, true);
});

test('POLICY A: verified provenance + независимый commercial review → owner=true', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-comm',
      article: 'PC-1',
      review_queue_memberships: ['commercial_review'],
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-policy-comm', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-comm',
        owner_review_reasons: ['approved_policy_conflict', 'commercial_review'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
});

test('POLICY A: verified provenance + large inventory review → owner=true', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-large',
      article: 'PC-1',
      review_queue_memberships: ['large_inventory_review'],
      extra: {
        approved_policy_conflict: true,
        large_inventory_review: { projected_days_of_stock: 120, target_days_of_stock: 14 },
      },
    })],
    products: [workProduct({ rowIdentity: 'r-policy-large', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-large',
        owner_review_reasons: ['approved_policy_conflict', 'large_inventory_review'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.section, 'owner_decisions');
});

test('POLICY A: policy conflict + unknown stock → data problem, не owner business decision', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-badstock',
      article: 'PC-1',
      free_stock: null,
      missing_fields: ['free_stock'],
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({
      rowIdentity: 'r-policy-badstock',
      article: 'PC-1',
      freeStock: null,
      blockingReason: 'free_stock_unknown',
      requiredData: ['free_stock'],
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-badstock',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.DATA_ERROR_UNKNOWN_STOCK);
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.section, 'data_problems');
});

test('POLICY A: policy conflict + отсутствующая цена → data problem, owner=false', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-noprice',
      article: 'PC-1',
      purchase_price: null,
      reason_codes: ['missing_purchase_price'],
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-policy-noprice', article: 'PC-1', priceNum: null })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-noprice',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING);
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.section, 'data_problems');
});

test('POLICY A: policy conflict без canonical-ссылки (existing_matrix_item=false) → matrix gap, owner=false', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-policy-nomatrix',
      article: 'PC-1',
      extra: { approved_policy_conflict: true, existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-policy-nomatrix',
      article: 'PC-1',
      assortment_matrix: { matched: false },
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-policy-nomatrix',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.MATRIX_UNMATCHED);
  assert.equal(item.requires_owner_decision, false);
});

test('POLICY A: обычный canonical item без конфликта → поведение не меняется', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-plain',
      article: 'PC-1',
      review_queue_memberships: [],
    })],
    products: [workProduct({ rowIdentity: 'r-plain', article: 'PC-1' })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.READY_WITH_EXPLANATION);
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.section, 'ready');
  assert.ok(!item.evidence.some(line => line.startsWith('policy_provenance=')));
});

// ---------- data-driven provenance registry ----------

test('provenance: сессия из registry → POLICY A применяется (owner=false)', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-reg-ok',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-reg-ok', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-reg-ok',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, false);
  assert.ok(item.evidence.includes(`policy_provenance=${VERIFIED_SESSION}`));
});

test('provenance: нужной сессии нет в registry → owner review остаётся', () => {
  const input = canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-reg-miss',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-reg-miss', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-reg-miss',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  });
  input.ownerReviewSessions = [{ session_id: 'some-other-session', control_artifact_path: 'x' }];
  const { item } = singleItemTriage(() => input);
  assert.equal(item.requires_owner_decision, true);
});

test('provenance: registry пуст/отсутствует → fail-safe, owner review остаётся', () => {
  for (const sessions of [undefined, [], null]) {
    const input = canonicalMatrixBundle({
      drafts: [draftItem({
        rowIdentity: 'r-reg-empty',
        article: 'PC-1',
        extra: { approved_policy_conflict: true },
      })],
      products: [workProduct({ rowIdentity: 'r-reg-empty', article: 'PC-1' })],
      ownerReview: {
        items: [ownerReviewEntry({
          rowIdentity: 'r-reg-empty',
          owner_review_reasons: ['approved_policy_conflict'],
          owner_action_required: true,
          owner_action_class: 'OWNER_ACTION_REQUIRED',
        })],
      },
    });
    input.ownerReviewSessions = sessions;
    const { item } = singleItemTriage(() => input);
    assert.equal(item.requires_owner_decision, true, `fail-safe for sessions=${JSON.stringify(sessions)}`);
  }
});

test('provenance: битый registry-файл → CLI fail-safe без падения', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-reg-'));
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify([{ json: { workingOrderVersion: 'v-test' } }]));
  fs.writeFileSync(path.join(dir, 'manual-review.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, 'owner-review.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, 'run-metadata.json'), JSON.stringify({ run_id: 'reg-run-1', status: 'completed' }));
  const registryPath = path.join(dir, 'owner-review-sessions.json');
  fs.writeFileSync(registryPath, '{ broken json !!!');
  const { spawnSync } = require('node:child_process');
  try {
    const result = spawnSync(process.execPath, [
      'scripts/triage-purchasing-review.js',
      '--run-dir', dir,
      '--sessions', registryPath,
    ], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('reg-run-1'), result.stdout);
    assert.ok((result.stderr || '').includes('TRIAGE_SESSIONS_WARNING'), result.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provenance: control artifact отсутствует → сессия не считается verified', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-art-'));
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify([{ json: { workingOrderVersion: 'v-test' } }]));
  fs.writeFileSync(path.join(dir, 'manual-review.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, 'owner-review.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, 'run-metadata.json'), JSON.stringify({ run_id: 'reg-run-2', status: 'completed' }));
  const registryPath = path.join(dir, 'sessions.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    sessions: [{
      session_id: 'owner-review-2026-08-19',
      verified_at: '2026-08-19',
      verified_by: 'test',
      control_artifact_path: 'data/purchasing/DOES_NOT_EXIST.xlsx',
    }],
  }));
  const { spawnSync } = require('node:child_process');
  try {
    const result = spawnSync(process.execPath, [
      'scripts/triage-purchasing-review.js',
      '--run-dir', dir,
      '--sessions', registryPath,
    ], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('reg-run-2'), result.stdout);
    assert.ok((result.stderr || '').includes('control artifact not found'), result.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- sku_id traceability ----------

test('sku_id: идентификатор отчёта сохраняется в triage output', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-sku-report',
      article: 'PC-1',
      extra: { internal_product_id: 'SKU-REPORT-9' },
    })],
    products: [workProduct({ rowIdentity: 'r-sku-report', article: 'PC-1', extra: { internalProductId: 'SKU-REPORT-9' } })],
  }));
  assert.equal(item.sku_id, 'SKU-REPORT-9');
  assert.equal(item.sku_id_source, 'report_internal_product_id');
});

test('sku_id: при отсутствии в отчёте подставляется canonical sku_id точного совпадения (traceability)', () => {
  const { item } = singleItemTriage(() => canonicalMatrixBundle({
    drafts: [draftItem({ rowIdentity: 'r-sku-canon', article: 'PC-1' })],
    products: [workProduct({ rowIdentity: 'r-sku-canon', article: 'PC-1' })],
  }));
  assert.equal(item.sku_id, 'SKU-CANON-1');
  assert.equal(item.sku_id_source, 'canonical_matrix_exact_match');
  // matching key unchanged: article still drives canonical matching
  assert.equal(item.supplier_sku, 'PC-1');
});

test('sku_id: отсутствует везде → NULL, без подмены артикулом', () => {
  const input = bundle({
    drafts: [draftItem({ rowIdentity: 'r-sku-none', article: 'NO-MX-1' })],
    products: [workProduct({ rowIdentity: 'r-sku-none', article: 'NO-MX-1' })],
  });
  input.canonicalMatrix = { items: [{ supplier_sku: 'OTHER-1', sku_id: 'SKU-X' }] };
  const { item } = singleItemTriage(() => input);
  assert.equal(item.sku_id, null);
  assert.equal(item.sku_id_source, null);
  assert.equal(item.supplier_sku, 'NO-MX-1');
});

test('sku_id: canonical matching по article не меняется при наличии sku_id', () => {
  const input = canonicalMatrixBundle({
    drafts: [draftItem({
      rowIdentity: 'r-sku-match',
      article: 'PC-1',
      extra: { approved_policy_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-sku-match', article: 'PC-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-sku-match',
        owner_review_reasons: ['approved_policy_conflict'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }, 'OWNER');
  const { item } = singleItemTriage(() => input);
  // sku_id найден через canonical, но provenance не подтверждена → owner=true
  assert.equal(item.sku_id, 'SKU-CANON-1');
  assert.equal(item.requires_owner_decision, true);
});

// --- owner_decision_status: ACTIVE vs BLOCKED_BY_DATA ---------------------

test('status: MATRIX_UNMATCHED + commercial_review → BLOCKED_BY_DATA, сигналы сохранены', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-bl-1',
      article: 'BL-1',
      extra: { existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-bl-1',
      article: 'BL-1',
      assortment_matrix: { matched: false },
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-bl-1',
        owner_review_reasons: ['commercial_review'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.MATRIX_UNMATCHED);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.owner_decision_status, 'BLOCKED_BY_DATA');
  assert.equal(item.owner_decision_blocker, 'data_or_linkage');
  assert.deepEqual(item.owner_signals, ['commercial_review']);
});

test('status: SUPPLIER_DATA_MISSING + owner_decision_conflict → BLOCKED_BY_DATA', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-bl-2',
      article: 'BL-2',
      evidence: { supplier_need_qty: null, supplier_recommended_qty: null },
      extra: { owner_decision_conflict: true },
    })],
    products: [workProduct({ rowIdentity: 'r-bl-2', article: 'BL-2' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-bl-2',
        owner_review_reasons: ['owner_decision_conflict'],
        owner_decision_conflict: true,
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.SUPPLIER_DATA_MISSING);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.owner_decision_status, 'BLOCKED_BY_DATA');
  assert.equal(item.owner_decision_blocker, 'data_or_linkage');
  assert.ok(item.owner_signals.includes('owner_decision_conflict'));
});

test('status: чистый commercial_review с количеством → ACTIVE', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-act-1',
      article: 'ACT-1',
      extra: { existing_matrix_item: true },
    })],
    products: [workProduct({ rowIdentity: 'r-act-1', article: 'ACT-1' })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-act-1',
        owner_review_reasons: ['commercial_review'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.owner_decision_status, 'ACTIVE');
  assert.equal(item.owner_decision_blocker, null);
});

test('status: нет рассчитанного количества → BLOCKED_BY_DATA (missing_recommended_quantity)', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-bl-3',
      article: 'BL-3',
      extra: { existing_matrix_item: true },
    })],
    products: [workProduct({
      rowIdentity: 'r-bl-3',
      article: 'BL-3',
      approvedOrderQuantity: 0,
      provisionalOrderQuantity: 0,
      finalRecommendedQuantity: 0,
      minmaxRecommendedQuantity: 0,
      analyzerCalculatedQuantity: 0,
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-bl-3',
        owner_review_reasons: ['commercial_review'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.owner_decision_status, 'BLOCKED_BY_DATA');
  assert.equal(item.owner_decision_blocker, 'missing_recommended_quantity');
});

test('status: EXIT-решение без количества не блокируется (quantity-independent)', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-exit-1',
      article: 'EXIT-1',
      review_queue_memberships: ['exit_review'],
      extra: { existing_matrix_item: true },
    })],
    products: [workProduct({
      rowIdentity: 'r-exit-1',
      article: 'EXIT-1',
      approvedOrderQuantity: 0,
      provisionalOrderQuantity: 0,
      finalRecommendedQuantity: 0,
      minmaxRecommendedQuantity: 0,
      analyzerCalculatedQuantity: 0,
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-exit-1',
        owner_review_reasons: ['exit_candidate'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }));
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.owner_decision_status, 'ACTIVE');
  assert.equal(item.owner_decision_blocker, null);
});

test('status: позиция без owner-решения имеет owner_decision_status null', () => {
  const { item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-none-1',
      article: 'NONE-1',
      extra: { existing_matrix_item: true },
    })],
    products: [workProduct({ rowIdentity: 'r-none-1', article: 'NONE-1' })],
  }));
  assert.equal(item.requires_owner_decision, false);
  assert.equal(item.owner_decision_status, null);
  assert.equal(item.owner_decision_blocker, null);
});

test('compaction через triage: BLOCKED_BY_DATA не попадает в business decisions', () => {
  const triage = triageReviewQueue(bundle({
    drafts: [
      draftItem({
        rowIdentity: 'r-mix-1',
        article: 'MIX-1',
        extra: { existing_matrix_item: false },
      }),
      draftItem({
        rowIdentity: 'r-mix-2',
        article: 'MIX-2',
        extra: { existing_matrix_item: true },
      }),
    ],
    products: [
      workProduct({
        rowIdentity: 'r-mix-1',
        article: 'MIX-1',
        assortment_matrix: { matched: false },
      }),
      workProduct({ rowIdentity: 'r-mix-2', article: 'MIX-2' }),
    ],
    ownerReview: {
      items: [
        ownerReviewEntry({
          rowIdentity: 'r-mix-1',
          owner_review_reasons: ['commercial_review'],
          owner_action_required: true,
          owner_action_class: 'OWNER_ACTION_REQUIRED',
        }),
        ownerReviewEntry({
          rowIdentity: 'r-mix-2',
          owner_review_reasons: ['commercial_review'],
          owner_action_required: true,
          owner_action_class: 'OWNER_ACTION_REQUIRED',
        }),
      ],
    },
  }), { generatedAt: '2026-09-05T00:00:00.000Z' });
  const compaction = triage.owner_review_compaction;
  assert.equal(compaction.owner_queue_sku_count, 2);
  assert.equal(compaction.blocked_by_data_count, 1);
  assert.equal(compaction.business_sku_count, 1);
  assert.equal(compaction.total_owner_decision_count, 1);
  assert.equal(compaction.blocked[0].article, 'MIX-1');
});

test('triage uses current pending workflow as authoritative manual queue', () => {
  const input = bundle({
    drafts: [
      draftItem({ rowIdentity: 'r-pending', article: 'P-1' }),
      draftItem({ rowIdentity: 'r-auto', article: 'A-1' }),
      draftItem({ rowIdentity: 'r-skip', article: 'S-1' }),
    ],
    products: [
      workProduct({ rowIdentity: 'r-pending', article: 'P-1', workflowStatus: 'pending_manual_review' }),
      workProduct({ rowIdentity: 'r-auto', article: 'A-1', workflowStatus: 'auto_approved' }),
      workProduct({ rowIdentity: 'r-skip', article: 'S-1', workflowStatus: 'no_order_action' }),
    ],
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-12T00:00:00.000Z' });
  assert.equal(triage.comparison.manual_queue_total_before, 1);
  assert.equal(triage.items.filter(item => item.row_identity !== null).length, 1);
  assert.equal(triage.items.find(item => item.row_identity !== null).row_identity, 'r-pending');
});

test('current owner queue excludes BLOCKED_BY_DATA until linkage is fixed', () => {
  const triage = triageReviewQueue(bundle({
    drafts: [draftItem({
      rowIdentity: 'r-blocked-current',
      article: 'BLK-1',
      review_queue_memberships: ['commercial_review'],
      extra: { existing_matrix_item: false },
    })],
    products: [workProduct({
      rowIdentity: 'r-blocked-current',
      article: 'BLK-1',
      workflowStatus: 'pending_manual_review',
      extra: { assortment_matrix: { matched: false } },
    })],
    ownerReview: {
      items: [ownerReviewEntry({
        rowIdentity: 'r-blocked-current',
        owner_review_reasons: ['commercial_review'],
        owner_action_required: true,
        owner_action_class: 'OWNER_ACTION_REQUIRED',
      })],
    },
  }), { generatedAt: '2026-09-12T00:00:00.000Z' });
  assert.equal(triage.comparison.manual_queue_total_before, 1);
  assert.equal(triage.comparison.real_owner_decisions_after, 0);
  assert.equal(triage.current_manual_sections.owner_decisions.count, 0);
  assert.equal(triage.current_manual_sections.matrix_gaps.count, 1);
  assert.equal(triage.current_manual_sections.matrix_gaps.items[0].original_section, 'owner_decisions');
  assert.equal(triage.current_manual_sections.matrix_gaps.items[0].owner_decision_status, 'BLOCKED_BY_DATA');
});

test('final unmatched blocker outranks stale supplier-data draft warnings', () => {
  const { triage, item } = singleItemTriage(() => bundle({
    drafts: [draftItem({
      rowIdentity: 'r-final-unmatched',
      article: 'UM-1',
      evidence: { supplier_recommended_qty: null },
    })],
    products: [workProduct({
      rowIdentity: 'r-final-unmatched',
      article: 'UM-1',
      workflowStatus: 'pending_manual_review',
      blockingReason: 'unmatched_product_no_assortment_policy',
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.MATRIX_UNMATCHED);
  assert.equal(triage.current_manual_sections.matrix_gaps.count, 1);
  assert.equal(triage.current_manual_sections.data_problems.count, 0);
});

test('final ambiguous blocker with duplicate diagnostics is a data problem', () => {
  const input = bundle({
    drafts: [draftItem({ rowIdentity: 'r-final-dup', article: 'DUP-X' })],
    products: [workProduct({
      rowIdentity: 'r-final-dup',
      article: 'DUP-X',
      workflowStatus: 'pending_manual_review',
      blockingReason: 'ambiguous_assortment_match',
    })],
    agentJson: {
      adapter_diagnostics: {
        duplicateIdentifiers: [{
          identifierType: 'article',
          value: 'DUP-X',
          rowNumbers: [10, 11],
          rowIdentities: ['r-final-dup', 'r-other-dup'],
        }],
      },
    },
  });
  const triage = triageReviewQueue(input, { generatedAt: '2026-09-12T00:00:00.000Z' });
  const item = triage.items.find(x => x.row_identity === 'r-final-dup');
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.DUPLICATE_SKU);
  assert.equal(triage.current_manual_sections.data_problems.count, 1);
});

test('final ABC/XYZ risk is an ACTIVE owner decision when order data is otherwise usable', () => {
  const { triage, item } = singleItemTriage(() => bundle({
    drafts: [draftItem({ rowIdentity: 'r-final-risk', article: 'RISK-1' })],
    products: [workProduct({
      rowIdentity: 'r-final-risk',
      article: 'RISK-1',
      workflowStatus: 'pending_manual_review',
      blockingReason: 'abc_xyz_risk:C/Z',
    })],
  }));
  assert.equal(item.reason_code, TRIAGE_CATEGORIES.OWNER_DECISION_REQUIRED);
  assert.equal(item.requires_owner_decision, true);
  assert.equal(item.owner_decision_status, 'ACTIVE');
  assert.equal(triage.current_manual_sections.owner_decisions.count, 1);
  assert.equal(triage.comparison.real_owner_decisions_after, 1);
});
