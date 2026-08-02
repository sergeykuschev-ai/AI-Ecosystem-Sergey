'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  AssortmentPolicyError,
  applyAssortmentPolicy,
  applyAssortmentPolicyToProducts,
  validateAssortmentPolicyRule,
  validateAssortmentPolicyStore,
} = require('../services/assortment_policy');
const {
  DEFAULT_POLICY_PATH,
  loadAssortmentPolicy,
  updateAssortmentPolicyRule,
} = require('../services/assortment_policy_store');

const UPDATED_AT = '2026-08-02T00:00:00.000Z';

function rule(overrides = {}) {
  return {
    sku: 'SKU-1',
    assortment_status: 'CORE',
    min_stock: 2,
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
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function apply(overrides = {}) {
  return applyAssortmentPolicy({
    sku: 'SKU-1',
    current_stock: 1,
    minmax_qty: 3,
    rule: rule(),
    run_context: { runId: 'run-1' },
    ...overrides,
  });
}

test('1. SKU без правила сохраняет Min/Max', () => {
  const result = applyAssortmentPolicy({ minmax_qty: 4, current_stock: 1 });
  assert.equal(result.policy_qty, 4);
  assert.equal(result.policy_adjusted, false);
  assert.equal(result.matched, false);
});

test('2. EXIT даёт policy_qty = 0', () => {
  const result = apply({ rule: rule({ assortment_status: 'EXIT' }) });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'EXIT');
});

test('3. активный purchase_hold даёт 0', () => {
  const result = apply({
    current_stock: 6,
    rule: rule({ purchase_hold: true, purchase_hold_until_stock: 3 }),
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'PURCHASE_HOLD');
});

test('4. purchase_hold=true без порога означает полный запрет', () => {
  assert.equal(apply({
    rule: rule({ purchase_hold: true }),
  }).policy_qty, 0);
});

test('5. порог без активного hold не блокирует заказ', () => {
  assert.equal(apply({
    current_stock: 4,
    minmax_qty: 2,
    rule: rule({ purchase_hold_until_stock: 3 }),
  }).policy_qty, 2);
});

test('6. остаток на MAX и выше даёт заказ 0', () => {
  assert.equal(apply({ current_stock: 6 }).policy_qty, 0);
  assert.equal(apply({ current_stock: 7 }).policy_qty, 0);
});

test('7. рекомендация урезается до MAX', () => {
  const result = apply({ current_stock: 4, minmax_qty: 5 });
  assert.equal(result.policy_qty, 2);
  assert.equal(result.projected_stock, 6);
  assert.equal(result.policy_rule, 'MAX_STOCK');
});

test('8. Mandatory CORE с нулевой историей восстанавливается', () => {
  const result = apply({
    current_stock: 0,
    minmax_qty: null,
    rule: rule({
      min_stock: 1,
      max_stock: 2,
      target_stock: 2,
      mandatory_assortment: true,
    }),
  });
  assert.equal(result.policy_qty, 2);
  assert.equal(result.policy_rule, 'MANDATORY_ASSORTMENT');
});

test('9. Mandatory CORE не превышает MAX', () => {
  const result = apply({
    current_stock: 0,
    minmax_qty: 0,
    rule: rule({
      min_stock: 4,
      max_stock: 4,
      target_stock: 4,
      mandatory_assortment: true,
    }),
  });
  assert.equal(result.policy_qty, 4);
  assert.equal(result.projected_stock, 4);
});

test('10. Purchase Hold имеет приоритет над mandatory', () => {
  const result = apply({
    current_stock: 0,
    minmax_qty: 0,
    rule: rule({
      min_stock: 2,
      purchase_hold: true,
      mandatory_assortment: true,
    }),
  });
  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'PURCHASE_HOLD');
});

test('11. EXIT имеет приоритет до решения владельца', () => {
  const result = apply({
    current_stock: 0,
    rule: rule({ assortment_status: 'EXIT', mandatory_assortment: true }),
  });
  assert.equal(result.policy_qty, 0);
  assert.deepEqual(result.applied_rules, ['EXIT']);
});

test('12. правило одного SKU не влияет на другой', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'A', assortment_status: 'EXIT' })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'A', freeStock: 0, finalRecommendedQuantity: 5 },
    { article: 'B', freeStock: 0, finalRecommendedQuantity: 5 },
  ], store);
  assert.equal(products[0].finalRecommendedQuantity, 0);
  assert.equal(products[1].finalRecommendedQuantity, 5);
});

test('13. повторный запуск детерминирован', () => {
  assert.deepEqual(apply(), apply());
});

test('14. некорректный статус отклоняется', () => {
  assert.throws(
    () => validateAssortmentPolicyRule(rule({ assortment_status: 'UNKNOWN' })),
    AssortmentPolicyError
  );
});

test('15. некорректный order_mode отклоняется', () => {
  assert.throws(
    () => validateAssortmentPolicyRule(rule({ order_mode: 'PALLET' })),
    /Неизвестный order_mode/
  );
});

test('16. невалидные числовые значения отклоняются', () => {
  assert.throws(() => validateAssortmentPolicyRule(rule({ min_stock: -1 })));
  assert.throws(() => validateAssortmentPolicyRule(rule({ box_qty: 1.5 })));
  assert.throws(() => validateAssortmentPolicyRule(rule({
    min_stock: 5,
    max_stock: 2,
  })));
});

test('17. повреждённый файл правил не игнорируется молча', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-invalid-'));
  const filePath = path.join(directory, 'policy.json');
  fs.writeFileSync(filePath, '{broken', 'utf8');
  assert.throws(
    () => loadAssortmentPolicy(filePath),
    error => error.code === 'ASSORTMENT_POLICY_INVALID_JSON'
  );
});

test('18-21. реальное правило Craftia соблюдает остатки 0/1/2 и нулевую историю', () => {
  const store = loadAssortmentPolicy(DEFAULT_POLICY_PATH).store;
  const craftia = store.rules.find(candidate => candidate.sku === 'GAL5427740');
  assert.ok(craftia);
  assert.equal(applyAssortmentPolicy({
    current_stock: 0,
    minmax_qty: null,
    rule: craftia,
  }).policy_qty, 2);
  assert.equal(applyAssortmentPolicy({
    current_stock: 1,
    minmax_qty: 0,
    rule: craftia,
  }).policy_qty, 0);
  assert.equal(applyAssortmentPolicy({
    current_stock: 2,
    minmax_qty: 0,
    rule: craftia,
  }).policy_qty, 0);
});

test('22-23. HYPO Puppy блокируется только выше порога', () => {
  const store = loadAssortmentPolicy(DEFAULT_POLICY_PATH).store;
  const puppy = store.rules.find(candidate => candidate.sku === '2548924');
  assert.equal(applyAssortmentPolicy({
    current_stock: 4,
    minmax_qty: 2,
    rule: puppy,
  }).policy_qty, 0);
  assert.equal(applyAssortmentPolicy({
    current_stock: 3,
    minmax_qty: 2,
    rule: puppy,
  }).policy_qty, 2);
});

test('24. Weight Control с hold=false не блокируется только из-за порога', () => {
  const store = loadAssortmentPolicy(DEFAULT_POLICY_PATH).store;
  const weight = store.rules.find(candidate => candidate.sku === '2548931');
  assert.equal(applyAssortmentPolicy({
    current_stock: 4,
    minmax_qty: 2,
    rule: weight,
  }).policy_qty, 2);
});

test('policy store rejects a duplicate SKU', () => {
  assert.throws(() => validateAssortmentPolicyStore({
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'a' }), rule({ sku: 'A' })],
  }), /Повторяющийся SKU/);
});

test('BOX fields validate but do not round first-phase quantity', () => {
  const result = apply({
    minmax_qty: 3,
    rule: rule({ order_mode: 'BOX', box_qty: 5 }),
  });
  assert.equal(result.policy_qty, 3);
  assert.equal(result.order_mode, 'BOX');
  assert.equal(result.box_qty, 5);
});

test('37-40. history records real changes once and isolates SKU', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-history-'));
  const policyPath = path.join(directory, 'policy.json');
  const historyPath = path.join(directory, 'history.json');
  fs.writeFileSync(policyPath, JSON.stringify({
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'A' }), rule({ sku: 'B' })],
  }), 'utf8');
  fs.writeFileSync(historyPath, JSON.stringify({
    version: 1,
    updated_at: UPDATED_AT,
    entries: [],
  }), 'utf8');
  const changedAt = '2026-08-02T01:00:00.000Z';
  const changed = updateAssortmentPolicyRule({
    policyPath,
    historyPath,
    rule: rule({ sku: 'A', max_stock: 7 }),
    reason: 'Owner changed MAX',
    changedBy: 'owner-web-ui',
    changedAt,
    sourceRunId: 'run-1',
  });
  assert.equal(changed.changed, true);
  assert.deepEqual(
    Object.keys(changed.historyEntry).sort(),
    ['changed_at', 'changed_by', 'new_value', 'old_value', 'reason', 'sku', 'source_run_id']
  );
  const repeated = updateAssortmentPolicyRule({
    policyPath,
    historyPath,
    rule: rule({ sku: 'A', max_stock: 7, updated_at: changedAt }),
    reason: 'Repeated save',
    changedBy: 'owner-web-ui',
    changedAt: '2026-08-02T02:00:00.000Z',
  });
  assert.equal(repeated.changed, false);
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].sku, 'A');
  assert.equal(
    loadAssortmentPolicy(policyPath).store.rules.find(item => item.sku === 'B').max_stock,
    6
  );
});
