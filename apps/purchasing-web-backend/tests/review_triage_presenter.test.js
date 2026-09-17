'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  presentOwnerReviewCompaction,
  resolvePosition,
  buildLookup,
} = require('../application/review_triage_presenter');

const canonicalMatrix = [
  {
    supplier_sku: 'ART-C',
    sku_id: 'SKU-C',
    min_stock: 2,
    target_stock: 5,
    max_stock: 9,
    rule_changed_by: 'owner-session-1',
  },
];

function compactionFixture() {
  return {
    compactor_version: 'owner-review-compactor-v2',
    read_only: true,
    source_run_id: 'run-1',
    owner_queue_sku_count: 2,
    business_sku_count: 1,
    blocked_by_data_count: 1,
    data_or_linkage_count: 0,
    package_decision_count: 1,
    package_sku_count: 1,
    individual_decision_count: 0,
    total_owner_decision_count: 1,
    groups: {},
    packages: [
      {
        package_id: 'PKG1',
        decision_type: 'POLICY_CONFIRM_UNVERIFIED',
        business_question: 'Подтвердить Min/Max?',
        owner_signals: ['approved_policy_conflict'],
        row_identities: ['row-c'],
        articles: ['ART-C'],
        sku_ids: ['SKU-C'],
        count: 1,
        content_hash: 'h',
        evidence_summary: 's',
        recommended_action: 'a',
        decision_options: [],
      },
    ],
    individuals: [
      {
        decision_id: 'dec-row-m',
        row_identity: 'row-m',
        article: 'ART-M',
        sku_id: null,
        name: 'Товар ручной',
        supplier: 'Поставщик',
        owner_signals: ['commercial_review'],
        signal_group: 'COMMERCIAL_ONLY',
        business_question: 'q',
        evidence: [],
        recommended_action: 'a',
      },
    ],
    exclusions: [],
    blocked: [
      {
        row_identity: 'row-b',
        article: 'ART-B',
        name: 'Товар blocked',
        sku_id: null,
        supplier: 'Поставщик',
        reason_code: 'MATRIX_UNMATCHED',
        owner_signals: ['commercial_review'],
        blocker: 'data_or_linkage',
        recommended_action: 'Сопоставить товар с canonical-матрицей.',
        note: 'После исправления данных может потребоваться решение владельца',
      },
    ],
  };
}

test('resolvePosition: приоритет canonical → items policy → suggested', () => {
  const lookup = buildLookup({
    webItems: [
      {
        row_id: 'row-x',
        stock: { free_stock: 7 },
        assortment_policy: { min_stock: 1, target_stock: 3, max_stock: 6 },
        sales: { last_28_days: 12 },
        quantities: { rollout_recommended_quantity: 4 },
      },
    ],
    manualReviewItems: [
      {
        rowIdentity: 'row-x',
        article: 'ART-X',
        suggested_minimum_shelf_stock: 10,
        suggested_target_stock: 20,
        suggested_maximum_stock: 30,
        evidence: {
          free_stock: 8,
          average_weekly_sales: 3,
          supplier_recommended_qty: 6,
        },
        rollout_recommended_quantity: 5,
      },
    ],
    canonicalMatrix,
  });
  const position = resolvePosition(lookup, 'row-x', 'ART-X');
  assert.equal(position.free_stock, 7); // items.json выигрывает у manual
  assert.equal(position.min_stock, 1);  // web policy выигрывает у suggested
  assert.equal(position.sales, 12);     // last_28_days выигрывает
  assert.equal(position.recommended_qty, 4);
  assert.equal(position.supplier_recommended_qty, 6); // единственный источник
  assert.equal(position.canonical_match, false);

  // suggested_* подхватывается, только когда нет ни canonical, ни web policy.
  const suggestedOnly = resolvePosition(
    buildLookup({
      webItems: [{ row_id: 'row-s' }],
      manualReviewItems: [
        {
          rowIdentity: 'row-s',
          article: 'ART-S',
          suggested_minimum_shelf_stock: 10,
          suggested_target_stock: 20,
          suggested_maximum_shelf_stock: 30,
          evidence: {},
        },
      ],
      canonicalMatrix,
    }),
    'row-s',
    'ART-S'
  );
  assert.equal(suggestedOnly.min_stock, 10);
  assert.equal(suggestedOnly.target_stock, 20);
  assert.equal(suggestedOnly.max_stock, 30);

  const canonicalPosition = resolvePosition(lookup, 'row-c', 'ART-C');
  assert.equal(canonicalPosition.min_stock, 2); // canonical выигрывает
  assert.equal(canonicalPosition.provenance, 'owner-session-1');
  assert.equal(canonicalPosition.canonical_match, true);
});

test('resolvePosition: NULL остаётся NULL, никогда не превращается в 0', () => {
  const lookup = buildLookup({ webItems: [], manualReviewItems: [], canonicalMatrix });
  const position = resolvePosition(lookup, 'row-none', 'ART-NONE');
  assert.equal(position.free_stock, null);
  assert.equal(position.min_stock, null);
  assert.equal(position.sales, null);
  assert.equal(position.recommended_qty, null);
  assert.equal(position.supplier_recommended_qty, null);
  assert.equal(position.canonical_match, false);
});

test('present: packages получают members, individuals/blocked — поля позиций', () => {
  const compaction = compactionFixture();
  const sources = {
    webItems: [
      {
        row_id: 'row-m',
        stock: { free_stock: 3 },
        sales: { last_28_days: 8 },
        quantities: { rollout_recommended_quantity: 2 },
      },
      {
        row_id: 'row-b',
        stock: { free_stock: 1 },
      },
    ],
    manualReviewItems: [
      {
        rowIdentity: 'row-m',
        evidence: { supplier_recommended_qty: 5 },
      },
      {
        rowIdentity: 'row-b',
        evidence: { supplier_recommended_qty: 9 },
      },
    ],
    canonicalMatrix,
  };
  const presented = presentOwnerReviewCompaction(compaction, sources);

  // Исходный объект не мутирован.
  assert.equal('members' in compaction.packages[0], false);
  assert.equal('free_stock' in compaction.individuals[0], false);

  const member = presented.packages[0].members[0];
  assert.equal(member.article, 'ART-C');
  assert.equal(member.sku_id, 'SKU-C');
  assert.equal(member.min_stock, 2);

  const individual = presented.individuals[0];
  assert.equal(individual.free_stock, 3);
  assert.equal(individual.sales, 8);
  assert.equal(individual.recommended_qty, 2);
  assert.equal(individual.supplier_recommended_qty, 5);
  assert.equal(individual.decision_id, 'dec-row-m'); // contract поля целы
  assert.deepEqual(individual.owner_signals, ['commercial_review']);

  const blocked = presented.blocked[0];
  assert.equal(blocked.free_stock, 1);
  assert.equal(blocked.supplier_recommended_qty, 9);
  assert.equal(blocked.blocker, 'data_or_linkage');
  assert.equal(blocked.reason_code, 'MATRIX_UNMATCHED');
});

test('present: отсутствующие источники не ломают обогащение (fail-soft)', () => {
  const presented = presentOwnerReviewCompaction(compactionFixture(), {});
  assert.equal(presented.packages[0].members[0].article, 'ART-C');
  assert.equal(presented.packages[0].members[0].free_stock, null);
  assert.equal(presented.individuals[0].recommended_qty, null);
  assert.equal(presented.blocked[0].sales, null);
  assert.equal(presentOwnerReviewCompaction(null, {}), null);
});
