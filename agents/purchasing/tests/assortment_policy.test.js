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
  DEFAULT_CANONICAL_MATRIX_PATH,
  DEFAULT_POLICY_PATH,
  loadAssortmentPolicy,
  loadAssortmentPolicySource,
  updateAssortmentPolicyRule,
} = require('../services/assortment_policy_store');
const {
  buildPhase2PurchasingDecisions,
} = require('../services/decision_engine');
const { buildWorkingOrder } = require('../services/working_order');

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

function phase2Product(overrides = {}) {
  return {
    rowIdentity: 'row-gal',
    rowNumber: 1,
    article: 'GAL5427740',
    name: 'Вет диета CRAFTIA Гипоаллердженик Дерм для кошек 1,4',
    supplier: 'Supplier',
    freeStock: 0,
    availableStock: 0,
    stockStatus: 'known',
    finalRecommendedQuantity: 0,
    analyzerCalculatedQuantity: 0,
    salesStatus: 'confirmed_zero',
    salesDailyRate: 0,
    salesRateSource: 'period_sales',
    salesTrend: 'consistent',
    mandatoryAssortment: false,
    mandatoryMinimumGap: 0,
    assortmentPriority: null,
    requiredData: [],
    warnings: [],
    abc: 'C',
    xyz: 'Z',
    priceNum: 100,
    quantityReason: 'confirmed_zero_sales',
    matchingHints: {},
    ...overrides,
  };
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
    { article: 'A', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 5 },
    { article: 'B', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 5 },
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
  const zeroStock = applyAssortmentPolicy({
    current_stock: 0,
    minmax_qty: null,
    rule: craftia,
  });
  assert.equal(zeroStock.policy_qty, 2);
  assert.equal(zeroStock.mandatory_minimum_gap, 2);
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

test('known zero stock keeps GAL5427740 mandatory quantity through Phase 2', () => {
  const store = loadAssortmentPolicy(DEFAULT_POLICY_PATH).store;
  const [product] = applyAssortmentPolicyToProducts([
    phase2Product(),
  ], store);
  const decisions = buildPhase2PurchasingDecisions({ products: [product] });
  const decision = decisions.decisions[0];
  const working = buildWorkingOrder([product], decisions.decisions).products[0];

  assert.equal(product.finalRecommendedQuantity, 2);
  assert.equal(product.mandatoryMinimumGap, 2);
  assert.equal(product.assortmentPolicy.policy_adjusted, true);
  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
  assert.ok(!decision.reasons.includes('confirmed_zero_sales_without_mandatory_gap'));
  assert.equal(working.provisionalOrderQuantity, 2);
});

test('unknown GAL5427740 stock stays unknown and is not policy-adjusted', () => {
  const store = loadAssortmentPolicy(DEFAULT_POLICY_PATH).store;
  const [product] = applyAssortmentPolicyToProducts([
    phase2Product({
      freeStock: null,
      availableStock: null,
      stockStatus: 'unknown',
      finalRecommendedQuantity: null,
      mandatoryMinimumGap: null,
      requiredData: ['free_stock'],
      quantityReason: 'incomplete_critical_data',
    }),
  ], store);
  const decision = buildPhase2PurchasingDecisions({ products: [product] })
    .decisions[0];

  assert.equal(product.finalRecommendedQuantity, null);
  assert.equal(product.mandatoryMinimumGap, null);
  assert.equal(product.assortmentPolicy.policy_adjusted, false);
  assert.equal(product.assortmentPolicy.policy_rule, 'NONE');
  assert.ok(product.assortmentPolicy.policy_warnings.includes(
    'CURRENT_STOCK_REQUIRED_FOR_MANDATORY_ASSORTMENT'
  ));
  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
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

test('canonical matrix contains all 5 legacy SKU', () => {
  const source = loadAssortmentPolicySource({ legacyPath: null });
  assert.equal(source.source, 'canonical-matrix');
  const skuIds = source.store.rules.map(r => r.sku);
  for (const legacySku of ['2548917', '2548924', '2548931', '2548955', 'GAL5427740']) {
    assert.ok(skuIds.includes(legacySku), `legacy SKU ${legacySku} must be present`);
  }
});

test('canonical active does not produce noRuleResult for legacy SKU', () => {
  const source = loadAssortmentPolicySource({ legacyPath: null });
  const [product] = applyAssortmentPolicyToProducts(
    [phase2Product({ article: 'GAL5427740' })],
    source.store
  );
  assert.equal(product.assortmentPolicy.matched, true);
  assert.equal(product.finalRecommendedQuantity, 2);
  assert.equal(product.assortmentPolicy.policy_rule, 'MANDATORY_ASSORTMENT');
});

test('GAL5427740 mandatory protection is preserved in canonical matrix', () => {
  const source = loadAssortmentPolicySource({ legacyPath: null });
  const galRule = source.store.rules.find(r => r.sku === 'GAL5427740');
  const zeroStock = applyAssortmentPolicy({
    current_stock: 0,
    minmax_qty: null,
    rule: galRule,
  });
  assert.equal(zeroStock.policy_qty, 2);
  assert.equal(zeroStock.mandatory_minimum_gap, 2);
  assert.equal(
    applyAssortmentPolicy({
      current_stock: 1,
      minmax_qty: 0,
      rule: galRule,
    }).policy_qty,
    0
  );
  assert.equal(
    applyAssortmentPolicy({
      current_stock: 2,
      minmax_qty: 0,
      rule: galRule,
    }).policy_qty,
    0
  );
});

test('HYPO Puppy purchase hold behaves identically with canonical matrix', () => {
  const source = loadAssortmentPolicySource({ legacyPath: null });
  const puppy = source.store.rules.find(r => r.sku === '2548924');
  assert.equal(
    applyAssortmentPolicy({
      current_stock: 4,
      minmax_qty: 2,
      rule: puppy,
    }).policy_qty,
    0
  );
  assert.equal(
    applyAssortmentPolicy({
      current_stock: 3,
      minmax_qty: 2,
      rule: puppy,
    }).policy_qty,
    2
  );
});

test('legacy and canonical policy produce identical quantities for all 5 SKU', () => {
  const legacy = loadAssortmentPolicy(DEFAULT_POLICY_PATH).store;
  const canonical = loadAssortmentPolicySource({ legacyPath: null }).store;
  const scenarios = [
    { sku: 'GAL5427740', current_stock: 0, minmax_qty: null },
    { sku: 'GAL5427740', current_stock: 1, minmax_qty: 0 },
    { sku: 'GAL5427740', current_stock: 2, minmax_qty: 0 },
    { sku: '2548924', current_stock: 4, minmax_qty: 2 },
    { sku: '2548924', current_stock: 3, minmax_qty: 2 },
    { sku: '2548931', current_stock: 4, minmax_qty: 2 },
    { sku: '2548917', current_stock: 4, minmax_qty: 2 },
    { sku: '2548955', current_stock: 4, minmax_qty: 2 },
  ];
  for (const s of scenarios) {
    const legacyRule = legacy.rules.find(r => r.sku === s.sku);
    const canonicalRule = canonical.rules.find(r => r.sku === s.sku);
    assert.ok(legacyRule, `legacy rule not found for ${s.sku}`);
    assert.ok(canonicalRule, `canonical rule not found for ${s.sku}`);
    const legacyResult = applyAssortmentPolicy({
      current_stock: s.current_stock,
      minmax_qty: s.minmax_qty,
      rule: legacyRule,
    });
    const canonicalResult = applyAssortmentPolicy({
      current_stock: s.current_stock,
      minmax_qty: s.minmax_qty,
      rule: canonicalRule,
    });
    assert.equal(
      legacyResult.policy_qty,
      canonicalResult.policy_qty,
      `quantity mismatch for ${s.sku} stock=${s.current_stock} minmax=${s.minmax_qty}: legacy=${legacyResult.policy_qty} canonical=${canonicalResult.policy_qty}`
    );
    assert.equal(
      legacyResult.policy_rule,
      canonicalResult.policy_rule,
      `rule mismatch for ${s.sku}`
    );
  }
});

test('canonical matrix does not contain representative SKU', () => {
  const source = loadAssortmentPolicySource({ legacyPath: null });
  const representative = [
    '7173648',
    '7173600',
    'CRF5421670',
    'PREM-001',
    'AIDA-001',
    'BEA-001',
    'WRP_SA400',
  ];
  for (const sku of representative) {
    assert.ok(
      !source.store.rules.some(r => r.sku.toUpperCase() === sku.toUpperCase()),
      `representative SKU ${sku} found in canonical matrix`
    );
  }
});

test('fallback to legacy policy works when canonical matrix is missing', () => {
  const source = loadAssortmentPolicySource({
    canonicalPath: '/nonexistent/canonical-matrix.json',
  });
  assert.equal(source.source, 'legacy-policy');
  const skuIds = source.store.rules.map(r => r.sku).sort();
  assert.deepEqual(skuIds, ['2548917', '2548924', '2548931', '2548955', 'GAL5427740']);
});

test('fallback to legacy policy works when canonical matrix is inactive', () => {
  const inactiveCanonical = JSON.stringify({
    version: 1,
    updated_at: UPDATED_AT,
    store: 'Миска',
    active: false,
    items: [],
  });
  const legacyPolicy = JSON.stringify(loadAssortmentPolicy(DEFAULT_POLICY_PATH).store);
  const fsModule = {
    readFileSync: (filePath) => {
      if (filePath.includes('canonical-assortment-matrix')) return inactiveCanonical;
      if (filePath.includes('miska-assortment-policy')) return legacyPolicy;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    existsSync: () => true,
    mkdirSync: () => {},
    writeFileSync: () => {},
    renameSync: () => {},
    unlinkSync: () => {},
  };
  const source = loadAssortmentPolicySource({ fsModule, legacyPath: DEFAULT_POLICY_PATH });
  assert.equal(source.source, 'legacy-policy');
  const skuIds = source.store.rules.map(r => r.sku).sort();
  assert.deepEqual(skuIds, ['2548917', '2548924', '2548931', '2548955', 'GAL5427740']);
});

test('rule stored by barcode matches product with same barcode but different article', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'BARCODE-123', assortment_status: 'EXIT' })],
  };
  const products = applyAssortmentPolicyToProducts([
    {
      article: 'ARTICLE-999',
      freeStock: 5,
      availableStock: 5,
      finalRecommendedQuantity: 3,
      matchingHints: { barcode: 'BARCODE-123' },
    },
  ], store);
  assert.equal(products[0].finalRecommendedQuantity, 0);
  assert.equal(products[0].assortmentPolicy.matched, true);
  assert.equal(products[0].assortmentPolicy.sku, 'BARCODE-123');
  assert.deepEqual(products.unmatchedActiveRules, []);
});

test('rule stored by internalProductId matches product', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'INTERNAL-42', min_stock: 2, mandatory_assortment: true })],
  };
  const products = applyAssortmentPolicyToProducts([
    {
      article: 'ARTICLE-999',
      freeStock: 0,
      availableStock: 0,
      finalRecommendedQuantity: 0,
      matchingHints: { internalProductId: 'INTERNAL-42' },
    },
  ], store);
  assert.equal(products[0].finalRecommendedQuantity, 2);
  assert.equal(products[0].assortmentPolicy.matched, true);
  assert.equal(products[0].assortmentPolicy.sku, 'INTERNAL-42');
  assert.deepEqual(products.unmatchedActiveRules, []);
});

test('rule stored by top-level sku matches product without article', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'SUPPLIER-SKU-7', max_stock: 4 })],
  };
  const products = applyAssortmentPolicyToProducts([
    {
      freeStock: 1,
      availableStock: 1,
      finalRecommendedQuantity: 5,
      supplierSku: 'SUPPLIER-SKU-7',
    },
  ], store);
  assert.equal(products[0].finalRecommendedQuantity, 3);
  assert.equal(products[0].assortmentPolicy.matched, true);
  assert.equal(products[0].assortmentPolicy.sku, 'SUPPLIER-SKU-7');
  assert.deepEqual(products.unmatchedActiveRules, []);
});

test('active rule with no matching product emits UNMATCHED_ASSORTMENT_POLICY_RULE', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'ORPHAN-1', assortment_status: 'CORE' })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'OTHER', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 0 },
  ], store);
  const unmatched = products.unmatchedActiveRules;
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].code, 'UNMATCHED_ASSORTMENT_POLICY_RULE');
  assert.equal(unmatched[0].sku, 'ORPHAN-1');
  assert.equal(unmatched[0].assortmentStatus, 'CORE');
  assert.equal(unmatched[0].severity, 'warning');
});

test('mandatory active rule missing from source emits MANDATORY_SKU_MISSING_FROM_SOURCE', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'MANDATORY-1', mandatory_assortment: true })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'OTHER', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 0 },
  ], store);
  const unmatched = products.unmatchedActiveRules;
  const codes = unmatched.map(d => d.code);
  assert.ok(codes.includes('UNMATCHED_ASSORTMENT_POLICY_RULE'));
  assert.ok(codes.includes('MANDATORY_SKU_MISSING_FROM_SOURCE'));
  const mandatory = unmatched.find(d => d.code === 'MANDATORY_SKU_MISSING_FROM_SOURCE');
  assert.equal(mandatory.sku, 'MANDATORY-1');
  assert.equal(mandatory.severity, 'warning');
});

test('EXIT rule missing from source is not reported as unmatched active', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'EXIT-1', assortment_status: 'EXIT' })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'OTHER', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 0 },
  ], store);
  assert.deepEqual(products.unmatchedActiveRules, []);
});

test('negative stock isolates one row to manual_review and continues others', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'A' }), rule({ sku: 'B' })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'A', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 5 },
    { article: 'B', freeStock: -1, availableStock: -1, finalRecommendedQuantity: 5 },
  ], store);

  assert.equal(products[0].finalRecommendedQuantity, 5);
  assert.equal(products[1].workflow_status, 'manual_review');
  assert.ok(products[1].reason_codes.includes('NEGATIVE_STOCK'));
  assert.equal(products[1].approved_quantity, 0);
  assert.equal(products[1].finalRecommendedQuantity, 0);
  assert.equal(products.isolatedRowDiagnostics.length, 1);
  assert.equal(products.isolatedRowDiagnostics[0].sku, 'B');
  assert.ok(products.isolatedRowDiagnostics[0].reasonCodes.includes('NEGATIVE_STOCK'));
});

test('invalid minmax quantity isolates one row to manual_review/DATA_INVALID', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'A' }), rule({ sku: 'B' })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'A', freeStock: 0, availableStock: 0, finalRecommendedQuantity: 5 },
    { article: 'B', freeStock: 0, availableStock: 0, finalRecommendedQuantity: -1 },
  ], store);

  assert.equal(products[0].finalRecommendedQuantity, 5);
  assert.equal(products[1].workflow_status, 'manual_review');
  assert.ok(products[1].reason_codes.includes('DATA_INVALID'));
  assert.equal(products[1].approved_quantity, 0);
  assert.equal(products[1].finalRecommendedQuantity, 0);
  assert.equal(products.isolatedRowDiagnostics.length, 1);
  assert.equal(products.isolatedRowDiagnostics[0].sku, 'B');
  assert.ok(products.isolatedRowDiagnostics[0].reasonCodes.includes('DATA_INVALID'));
});

test('all rows bad returns all manual_review without throwing', () => {
  const store = {
    version: 1,
    updated_at: UPDATED_AT,
    rules: [rule({ sku: 'A' }), rule({ sku: 'B' })],
  };
  const products = applyAssortmentPolicyToProducts([
    { article: 'A', freeStock: 0, availableStock: 0, finalRecommendedQuantity: -1 },
    { article: 'B', freeStock: 0, availableStock: 0, finalRecommendedQuantity: -2 },
  ], store);

  assert.equal(products.length, 2);
  assert.ok(products.every(p => p.workflow_status === 'manual_review'));
  assert.ok(products.every(p => p.approved_quantity === 0));
  assert.equal(products.isolatedRowDiagnostics.length, 2);
});

test('First Category Rollout: TEST in FIRST_ROLLOUT is postponed and awaits owner decision', () => {
  const result = apply({
    minmax_qty: 5,
    current_stock: 1,
    rule: rule({ assortment_status: 'TEST', rollout_status: 'FIRST_ROLLOUT', review_after_days: 30 }),
  });

  assert.equal(result.policy_qty, 0);
  assert.equal(result.policy_rule, 'FIRST_ROLLOUT_POSTPONE');
  assert.equal(result.first_rollout_test_awaiting, true);
  assert.equal(result.rollout_status, 'FIRST_ROLLOUT');
  assert.equal(result.review_after_days, 30);
  assert.ok(result.explanation.includes('FIRST_ROLLOUT'));
});

test('First Category Rollout: TEST in ACTIVE category follows normal rules', () => {
  const result = apply({
    minmax_qty: 5,
    current_stock: 1,
    rule: rule({ assortment_status: 'TEST', rollout_status: 'ACTIVE' }),
  });

  assert.equal(result.policy_qty, 5);
  assert.notEqual(result.policy_rule, 'FIRST_ROLLOUT_POSTPONE');
  assert.equal(result.first_rollout_test_awaiting, false);
});

test('First Category Rollout: CORE in FIRST_ROLLOUT is purchased automatically', () => {
  const result = apply({
    minmax_qty: 5,
    current_stock: 1,
    rule: rule({ assortment_status: 'CORE', rollout_status: 'FIRST_ROLLOUT' }),
  });

  assert.equal(result.policy_qty, 5);
  assert.equal(result.first_rollout_test_awaiting, false);
});

test('First Category Rollout: OPTIONAL in FIRST_ROLLOUT is purchased automatically', () => {
  const result = apply({
    minmax_qty: 5,
    current_stock: 1,
    rule: rule({ assortment_status: 'OPTIONAL', rollout_status: 'FIRST_ROLLOUT' }),
  });

  assert.equal(result.policy_qty, 5);
  assert.equal(result.first_rollout_test_awaiting, false);
});

test('First Category Rollout: TEST without rollout_status follows normal rules', () => {
  const result = apply({
    minmax_qty: 5,
    current_stock: 1,
    rule: rule({ assortment_status: 'TEST' }),
  });

  assert.equal(result.policy_qty, 5);
  assert.equal(result.first_rollout_test_awaiting, false);
});
