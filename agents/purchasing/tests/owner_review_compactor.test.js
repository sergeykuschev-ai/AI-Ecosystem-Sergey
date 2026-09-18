'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIGNAL_GROUPS,
  LINKAGE_REASONS,
  classifyOwnerItem,
  signalGroupFor,
  compactOwnerReview,
} = require('../review_triage/owner_review_compactor');

const VERIFIED_SESSION = 'owner-review-2026-08-19';

function ownerItem(overrides = {}) {
  return {
    row_identity: overrides.row_identity || 'smartzapas:hash:Лист_1:1',
    supplier_sku: 'supplier_sku' in overrides ? overrides.supplier_sku : 'ART-1',
    sku_id: 'sku_id' in overrides ? overrides.sku_id : 'SKU-1',
    sku_id_source: 'sku_id' in overrides ? 'report_internal_product_id' : null,
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
    evidence: overrides.evidence || [
      'free_stock=0',
      'reason_codes=[supplier_recommends_order]',
    ],
    recommended_action: overrides.recommended_action || 'Требуется решение владельца.',
  };
}

function reportWith(items) {
  return { source_run_id: 'run-test', items };
}

const canonicalMatrix = [
  {
    supplier_sku: 'ART-1',
    sku_id: 'SKU-1',
    min_stock: 1,
    target_stock: 2,
    max_stock: 3,
    assortment_status: 'CORE',
    rule_changed_by: 'OWNER',
  },
  {
    supplier_sku: 'ART-VER',
    sku_id: 'SKU-VER',
    min_stock: 1,
    target_stock: 2,
    max_stock: 3,
    assortment_status: 'CORE',
    rule_changed_by: VERIFIED_SESSION,
  },
];

test('один business SKU → individual decision, не package', () => {
  const result = compactOwnerReview(reportWith([ownerItem()]), { canonicalMatrix });
  assert.equal(result.business_sku_count, 1);
  assert.equal(result.package_decision_count, 0);
  assert.equal(result.individual_decision_count, 1);
  assert.equal(result.total_owner_decision_count, 1);
  const individual = result.individuals[0];
  assert.equal(individual.article, 'ART-1');
  assert.equal(individual.sku_id, 'SKU-1');
  assert.equal(individual.signal_group, SIGNAL_GROUPS.COMMERCIAL_ONLY);
  assert.ok(individual.decision_id.startsWith('dec-'));
  assert.ok(individual.business_question.length > 0);
  assert.ok(individual.evidence.length > 0);
  assert.ok(individual.recommended_action.length > 0);
});

test('одинаковые business conditions → один package', () => {
  const items = ['ART-A', 'ART-B', 'ART-C'].map((article, index) => ownerItem({
    row_identity: `id-${index}`,
    supplier_sku: article,
    sku_id: `SKU-${article}`,
    owner_signals: ['commercial_review'],
    evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]', 'projected_days=60', 'avg_weekly_sales=1'],
  }));
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.equal(result.business_sku_count, 3);
  assert.equal(result.package_decision_count, 1);
  assert.equal(result.packages[0].package_id, 'PKG2');
  assert.equal(result.packages[0].count, 3);
  assert.equal(result.individual_decision_count, 0);
  assert.equal(result.total_owner_decision_count, 1);
  assert.deepEqual(result.packages[0].articles.sort(), ['ART-A', 'ART-B', 'ART-C']);
});

test('одинаковый сигнал, но разные значимые условия → НЕ package', () => {
  const base = {
    owner_signals: ['commercial_review'],
  };
  const items = [
    ownerItem({ row_identity: 'id-1', supplier_sku: 'ART-A', evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]', 'projected_days=60'] }),
    ownerItem({ row_identity: 'id-2', supplier_sku: 'ART-B', evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]', 'projected_days=200'] }), // проекция >120
    ownerItem({ row_identity: 'id-3', supplier_sku: 'ART-C', evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]', 'avg_weekly_sales=5'] }), // продажи >2
    ownerItem({ row_identity: 'id-4', supplier_sku: 'ART-D', evidence: ['free_stock=0', 'reason_codes=[other_reason]'] }), // поставщик не рекомендует
  ];
  void base;
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  // Только ART-A удовлетворяет всем условиям пакета — пакет из одного
  // члена не образуется (нет экономии решений), всё индивидуально.
  assert.equal(result.package_decision_count, 0);
  assert.equal(result.individual_decision_count, 4);
  assert.equal(result.total_owner_decision_count, 4);
});

test('DATA_OR_LINKAGE исключается из package/individual decisions', () => {
  const items = [
    ownerItem({ row_identity: 'id-1', supplier_sku: null }),                    // нет артикула
    ownerItem({ row_identity: 'id-2', supplier_sku: 'UNKNOWN' }),               // UNKNOWN
    ownerItem({ row_identity: 'id-3', supplier_sku: 'ART-X', owner_signals: ['exit_candidate'] }), // EXIT без canonical
    ownerItem({ row_identity: 'id-4', supplier_sku: 'ART-Y', evidence: ['duplicate_supplier_sku=ART-Y (rows: 1, 2)'] }),
    ownerItem({ row_identity: 'id-5', supplier_sku: 'ART-Z', reason_code: 'DATA_ERROR_IDENTITY' }),
    ownerItem({ row_identity: 'id-6', supplier_sku: 'ART-OK' }),                // настоящий business
  ];
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.equal(result.business_sku_count, 1);
  assert.equal(result.data_or_linkage_count, 5);
  assert.equal(result.exclusions.length, 5);
  assert.equal(result.individual_decision_count, 1);
  const reasons = result.exclusions.map(entry => entry.linkage_reason).sort();
  assert.deepEqual(reasons, [
    LINKAGE_REASONS.ARTICLE,
    LINKAGE_REASONS.ARTICLE,
    LINKAGE_REASONS.EXIT,
    LINKAGE_REASONS.IDENTITY,
    LINKAGE_REASONS.IDENTITY,
  ]);
});

test('exit_candidate с подтверждённым canonical EXIT → business', () => {
  const matrix = [{
    supplier_sku: 'ART-EXIT', assortment_status: 'EXIT', rule_changed_by: VERIFIED_SESSION,
  }];
  const classification = classifyOwnerItem(
    ownerItem({ supplier_sku: 'ART-EXIT', owner_signals: ['exit_candidate'] }),
    new Map([['ART-EXIT', matrix[0]]])
  );
  assert.equal(classification.group, 'business');
});

test('rowIdentity считается ровно один раз (дубликат строки игнорируется)', () => {
  const item = ownerItem({ row_identity: 'dup-1', supplier_sku: 'ART-A' });
  const result = compactOwnerReview(reportWith([item, { ...item }]), { canonicalMatrix });
  assert.equal(result.business_sku_count, 1);
  assert.equal(result.total_owner_decision_count, 1);
});

test('пересекающиеся owner_signals дают ровно одну группу без двойного счёта', () => {
  const items = [ownerItem({
    row_identity: 'id-1',
    supplier_sku: 'ART-PCL',
    owner_signals: ['approved_policy_conflict', 'commercial_review', 'large_inventory_review'],
  })];
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.equal(result.business_sku_count, 1);
  assert.equal(result.groups[SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL_PLUS_LARGE], 1);
  const totalInGroups = Object.values(result.groups).reduce((sum, count) => sum + count, 0);
  assert.equal(totalInGroups, 1);
  assert.equal(result.total_owner_decision_count, 1);
});

test('package_id стабилен при изменении порядка входа', () => {
  const makeItems = () => ['ART-A', 'ART-B', 'ART-C'].map((article, index) => ownerItem({
    row_identity: `id-${index}`,
    supplier_sku: article,
    owner_signals: ['commercial_review'],
    evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]'],
  }));
  const first = compactOwnerReview(reportWith(makeItems()), { canonicalMatrix });
  const second = compactOwnerReview(reportWith(makeItems().reverse()), { canonicalMatrix });
  assert.equal(first.packages[0].package_id, second.packages[0].package_id);
  assert.deepEqual(first.packages[0].row_identities, second.packages[0].row_identities);
  assert.deepEqual(first, second);
});

test('individual decision_id стабилен и не зависит от порядка входа', () => {
  const items = [
    ownerItem({ row_identity: 'id-1', supplier_sku: 'ART-A' }),
    ownerItem({ row_identity: 'id-2', supplier_sku: 'ART-B' }),
  ];
  const first = compactOwnerReview(reportWith(items), { canonicalMatrix });
  const second = compactOwnerReview(reportWith([...items].reverse()), { canonicalMatrix });
  assert.deepEqual(
    first.individuals.map(i => i.decision_id).sort(),
    second.individuals.map(i => i.decision_id).sort()
  );
  assert.deepEqual(first, second);
});

test('отсутствие sku_id не ломает grouping', () => {
  const items = ['ART-A', 'ART-B'].map((article, index) => ownerItem({
    row_identity: `id-${index}`,
    supplier_sku: article,
    sku_id: null,
    owner_signals: ['commercial_review'],
    evidence: ['free_stock=0', 'reason_codes=[supplier_recommends_order]'],
  }));
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.equal(result.packages[0].count, 2);
  assert.deepEqual(result.packages[0].sku_ids, []);
});

test('PKG3 требует verified provenance и free_stock < 9', () => {
  const matrix = [
    { supplier_sku: 'ART-V', rule_changed_by: VERIFIED_SESSION, min_stock: 1, target_stock: 2, max_stock: 3 },
    { supplier_sku: 'ART-O', rule_changed_by: 'OWNER', min_stock: 1, target_stock: 2, max_stock: 3 },
  ];
  const items = [
    ownerItem({ row_identity: 'id-1', supplier_sku: 'ART-V', owner_signals: ['approved_policy_conflict', 'large_inventory_review'], evidence: ['free_stock=3'] }),
    ownerItem({ row_identity: 'id-2', supplier_sku: 'ART-V2', owner_signals: ['approved_policy_conflict', 'large_inventory_review'], evidence: ['free_stock=4'] }), // free_stock >=9
    ownerItem({ row_identity: 'id-3', supplier_sku: 'ART-V3', owner_signals: ['approved_policy_conflict', 'large_inventory_review'], evidence: ['free_stock=15'] }), // без provenance
    ownerItem({ row_identity: 'id-4', supplier_sku: 'ART-O', owner_signals: ['approved_policy_conflict', 'large_inventory_review'], evidence: ['free_stock=3'] }),
  ];
  const matrixFull = matrix.concat([
    { supplier_sku: 'ART-V2', rule_changed_by: VERIFIED_SESSION, min_stock: 1, target_stock: 2, max_stock: 3 },
    { supplier_sku: 'ART-V3', rule_changed_by: VERIFIED_SESSION, min_stock: 1, target_stock: 2, max_stock: 3 },
  ]);
  const result = compactOwnerReview(reportWith(items), {
    canonicalMatrix: matrixFull,
    verifiedOwnerSessionIds: [VERIFIED_SESSION],
  });
  const pkg3 = result.packages.find(pkg => pkg.package_id === 'PKG3');
  assert.ok(pkg3);
  assert.deepEqual(pkg3.articles, ['ART-V', 'ART-V2']);
  assert.equal(result.individual_decision_count, 2);
});

test('PKG1 не захватывает позицию с подтверждённой provenance', () => {
  const items = [
    ownerItem({ row_identity: 'id-1', supplier_sku: 'ART-VER', owner_signals: ['approved_policy_conflict'] }),
  ];
  const result = compactOwnerReview(reportWith(items), {
    canonicalMatrix,
    verifiedOwnerSessionIds: [VERIFIED_SESSION],
  });
  assert.equal(result.package_decision_count, 0);
  assert.equal(result.individual_decision_count, 1);
});

test('malformed позиция без идентичности → exclusion; без статуса, но с артикулом → fail-safe blocked', () => {
  const items = [
    { requires_owner_decision: true, owner_signals: ['commercial_review'], evidence: [] },
    { requires_owner_decision: true, supplier_sku: 'ART-NOSTATUS', owner_signals: ['commercial_review'], evidence: [] },
  ];
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.equal(result.business_sku_count, 0);
  assert.equal(result.data_or_linkage_count, 1);
  assert.equal(result.blocked_by_data_count, 1);
  assert.equal(result.owner_queue_sku_count, 2);
  assert.equal(result.total_owner_decision_count, 0);
  assert.equal(result.blocked[0].blocker, 'status_not_active');
  assert.equal(result.exclusions[0].linkage_reason, LINKAGE_REASONS.ARTICLE);
});

test('BLOCKED_BY_DATA исключается из packages/individuals, сигналы сохранены', () => {
  const items = [
    ownerItem({
      row_identity: 'id-b1',
      supplier_sku: 'ART-B1',
      owner_decision_status: 'BLOCKED_BY_DATA',
      owner_decision_blocker: 'data_or_linkage',
      reason_code: 'MATRIX_UNMATCHED',
      owner_signals: ['commercial_review'],
      recommended_action: 'Сопоставить товар с canonical-матрицей.',
    }),
    ownerItem({ row_identity: 'id-ok', supplier_sku: 'ART-OK' }),
  ];
  const result = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.equal(result.owner_queue_sku_count, 2);
  assert.equal(result.business_sku_count, 1);
  assert.equal(result.blocked_by_data_count, 1);
  assert.equal(result.individual_decision_count, 1);
  assert.equal(result.total_owner_decision_count, 1);
  const blockedEntry = result.blocked[0];
  assert.equal(blockedEntry.article, 'ART-B1');
  assert.equal(blockedEntry.blocker, 'data_or_linkage');
  assert.deepEqual(blockedEntry.owner_signals, ['commercial_review']);
  assert.equal(blockedEntry.reason_code, 'MATRIX_UNMATCHED');
  assert.match(blockedEntry.note, /После исправления данных/);
});

test('после устранения data defect тот же rowIdentity может стать ACTIVE', () => {
  const blockedItem = ownerItem({
    row_identity: 'id-fix',
    supplier_sku: 'ART-FIX',
    owner_decision_status: 'BLOCKED_BY_DATA',
    owner_decision_blocker: 'missing_recommended_quantity',
  });
  const activeItem = ownerItem({
    row_identity: 'id-fix',
    supplier_sku: 'ART-FIX',
    owner_decision_status: 'ACTIVE',
    owner_decision_blocker: null,
  });
  const blockedResult = compactOwnerReview(reportWith([blockedItem]), { canonicalMatrix });
  assert.equal(blockedResult.blocked_by_data_count, 1);
  assert.equal(blockedResult.total_owner_decision_count, 0);
  const activeResult = compactOwnerReview(reportWith([activeItem]), { canonicalMatrix });
  assert.equal(activeResult.blocked_by_data_count, 0);
  assert.equal(activeResult.total_owner_decision_count, 1);
  assert.equal(activeResult.individuals[0].article, 'ART-FIX');
});

test('compactor детерминирован: повторный вызов даёт идентичный результат', () => {
  const items = [
    ownerItem({ row_identity: 'id-1', supplier_sku: 'ART-A', owner_signals: ['commercial_review'] }),
    ownerItem({ row_identity: 'id-2', supplier_sku: 'ART-B', owner_signals: ['large_inventory_review'] }),
  ];
  const first = compactOwnerReview(reportWith(items), { canonicalMatrix });
  const second = compactOwnerReview(reportWith(items), { canonicalMatrix });
  assert.deepEqual(first, second);
  assert.equal(first.compactor_version, 'owner-review-compactor-v2');
  assert.equal(first.read_only, true);
});

test('signalGroupFor: все восемь комбинаций взаимоисключаемы', () => {
  assert.equal(signalGroupFor(['approved_policy_conflict']), SIGNAL_GROUPS.POLICY_ONLY);
  assert.equal(signalGroupFor(['approved_policy_conflict', 'commercial_review']), SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL);
  assert.equal(signalGroupFor(['approved_policy_conflict', 'large_inventory_review']), SIGNAL_GROUPS.POLICY_PLUS_LARGE);
  assert.equal(signalGroupFor(['approved_policy_conflict', 'commercial_review', 'large_inventory_review']), SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL_PLUS_LARGE);
  assert.equal(signalGroupFor(['commercial_review']), SIGNAL_GROUPS.COMMERCIAL_ONLY);
  assert.equal(signalGroupFor(['commercial_review', 'large_inventory_review']), SIGNAL_GROUPS.COMMERCIAL_PLUS_LARGE);
  assert.equal(signalGroupFor(['large_inventory_review']), SIGNAL_GROUPS.LARGE_ONLY);
  assert.equal(signalGroupFor(['exit_blocked_approved_policy']), SIGNAL_GROUPS.OTHER_OWNER_DECISION);
  assert.equal(signalGroupFor([]), SIGNAL_GROUPS.OTHER_OWNER_DECISION);
});
