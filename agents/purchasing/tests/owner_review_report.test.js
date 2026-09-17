'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compactOwnerReview } = require('../review_triage/owner_review_compactor');
const {
  renderOwnerReviewHtml,
  escapeHtml,
} = require('../review_triage/owner_review_report');

const VERIFIED_SESSION = 'owner-review-2026-08-19';

function ownerItem(overrides = {}) {
  return {
    row_identity: overrides.row_identity || 'id-1',
    supplier_sku: 'supplier_sku' in overrides ? overrides.supplier_sku : 'ART-1',
    sku_id: 'sku_id' in overrides ? overrides.sku_id : null,
    sku_id_source: null,
    name: overrides.name || 'Товар тестовый',
    supplier: overrides.supplier || 'ООО Поставщик',
    requires_owner_decision: true,
    owner_decision_status: 'owner_decision_status' in overrides
      ? overrides.owner_decision_status
      : 'ACTIVE',
    owner_decision_blocker: 'owner_decision_blocker' in overrides
      ? overrides.owner_decision_blocker
      : null,
    owner_signals: overrides.owner_signals || ['commercial_review'],
    reason_code: overrides.reason_code || 'OWNER_DECISION_REQUIRED',
    evidence: overrides.evidence || ['free_stock=0', 'reason_codes=[supplier_recommends_order]'],
    recommended_action: 'Требуется решение владельца.',
  };
}

function buildFixture() {
  // 4 business SKU в одном пакете + 2 индивидуальные + 1 DATA_OR_LINKAGE.
  const items = [
    ...['ART-A', 'ART-B', 'ART-C', 'ART-D'].map((article, index) => ownerItem({
      row_identity: `id-pkg-${index}`,
      supplier_sku: article,
      name: `Товар пакетный ${article}`,
      evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]'],
    })),
    ownerItem({
      row_identity: 'id-ind-1',
      supplier_sku: 'ART-IND1',
      name: 'Товар индивидуальный 1 <script>alert(1)</script>',
      sku_id: 'SKU-IND1',
      owner_signals: ['large_inventory_review'],
      evidence: ['free_stock=5'],
    }),
    ownerItem({
      row_identity: 'id-ind-2',
      supplier_sku: 'ART-IND2',
      name: 'Товар индивидуальный 2',
      owner_signals: ['approved_policy_conflict', 'commercial_review'],
      evidence: ['free_stock=2'],
    }),
    ownerItem({
      row_identity: 'id-link-1',
      supplier_sku: null,
      name: 'Позиция без артикула',
      owner_signals: ['exit_candidate'],
    }),
  ];
  const triage = {
    source_run_id: 'run-fixture',
    calculation_version: 'test-v1',
    comparison: {
      manual_queue_total_before: 10,
      ready: 3,
      data_problems: 2,
      matrix_gaps: 1,
      real_owner_decisions_after: 6,
      moved_out_of_owner_queue: 4,
    },
    sections: {
      ready: { items: [], count: 3 },
      data_problems: { items: [], count: 2 },
      matrix_gaps: { items: [], count: 1 },
      owner_decisions: { items: items.filter(i => i.requires_owner_decision), count: 6 },
    },
    items,
  };
  const compaction = compactOwnerReview(triage, {
    canonicalMatrix: [],
    verifiedOwnerSessionIds: [VERIFIED_SESSION],
  });
  return { triage, compaction };
}

function renderFixture(extra = {}) {
  const { triage, compaction } = buildFixture();
  return renderOwnerReviewHtml({
    triage,
    compaction,
    canonicalMatrix: extra.canonicalMatrix || [],
    manualReview: extra.manualReview || null,
  });
}

test('summary корректен: 6 business SKU → 1 package + 2 individual = 3 решения', () => {
  const html = renderFixture();
  assert.match(html, /Нужно принять 3 решения/);
  assert.match(html, /6 бизнес-позиций/);
  assert.match(html, /1 пакетных \+ 2 индивидуальных/);
  assert.match(html, /1 проблем данных/);
  assert.match(html, /run-fixture/);
});

test('60/4/28/32-подобный контракт: business/data/packages/individuals/total в заголовке', () => {
  const { triage, compaction } = buildFixture();
  assert.equal(compaction.business_sku_count, 6);
  assert.equal(compaction.data_or_linkage_count, 1);
  assert.equal(compaction.package_decision_count, 1);
  assert.equal(compaction.individual_decision_count, 2);
  assert.equal(compaction.total_owner_decision_count, 3);
  const html = renderOwnerReviewHtml({ triage, compaction, canonicalMatrix: [] });
  for (const number of ['6', '1', '2', '3']) {
    assert.ok(html.includes(number), `html should contain ${number}`);
  }
});

test('DATA_OR_LINKAGE не попадает в owner decisions', () => {
  const html = renderFixture();
  assert.match(html, /Позиция без артикула/); // присутствует в блоке данных
  const individualCards = html.match(/<details class="individual">/g) || [];
  assert.equal(individualCards.length, 2);
  const packageCards = html.match(/<details class="package">/g) || [];
  assert.equal(packageCards.length, 1);
});

test('NULL отображается как «нет данных», не как 0', () => {
  const { triage, compaction } = buildFixture();
  const html = renderOwnerReviewHtml({ triage, compaction, canonicalMatrix: [] });
  assert.match(html, /нет данных/);
  assert.doesNotMatch(html, /<dd>0<\/dd>/);
});

test('HTML escaping для name/evidence', () => {
  const html = renderFixture();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(escapeHtml('<a href="x">&"'), /&lt;a href=&quot;x&quot;&gt;&amp;&quot;/);
});

test('output стабилен на одном входе', () => {
  const first = renderFixture();
  const second = renderFixture();
  assert.equal(first, second);
  assert.match(first, /owner-review-report-v1/);
});

test('отсутствие write/action controls и внешних URL', () => {
  const html = renderFixture();
  assert.doesNotMatch(html, /<button|<form|fetch\(|XMLHttpRequest|method="post"/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /src="/);
  assert.doesNotMatch(html, /<script/i);
});

test('карточка пакета содержит товары и бизнес-вопрос', () => {
  const html = renderFixture();
  assert.match(html, /PKG2 — COMMERCIAL_ACCEPT_CALC — 4 SKU/);
  assert.match(html, /ART-A/);
  assert.match(html, /ART-D/);
  assert.match(html, /Вопрос:/);
  assert.match(html, /Варианты:/);
});

test('canonical Min/Target/Max подтягиваются по exact supplier_sku', () => {
  const html = renderFixture({
    canonicalMatrix: [
      { supplier_sku: 'ART-IND1', min_stock: 1, target_stock: 3, max_stock: 5 },
    ],
  });
  assert.match(html, /1\/3\/5/);
});

test('details из manualReview подтягиваются по row_identity', () => {
  const { triage, compaction } = buildFixture();
  const manualReview = {
    items: [
      {
        rowIdentity: 'id-ind-1',
        article: 'ART-IND1',
        rollout_recommended_quantity: 7,
        evidence: {
          average_weekly_sales: 0.5,
          projected_days_of_stock: 90,
          supplier_recommended_qty: 3,
          free_stock: 5,
        },
      },
    ],
  };
  const html = renderOwnerReviewHtml({ triage, compaction, canonicalMatrix: [], manualReview });
  assert.match(html, /ART-IND1/);
  assert.match(html, />7</); // recommendedQty из rollout_recommended_quantity
  assert.match(html, />3</); // supplierRecommendedQty
  assert.match(html, /0\.5/); // продажи
});

test('некорректный вход → TypeError, а не молчаливый отчёт', () => {
  assert.throws(() => renderOwnerReviewHtml({}), TypeError);
  assert.throws(() => renderOwnerReviewHtml({ triage: {} }), TypeError);
});
