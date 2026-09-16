'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  resolveActiveOwnerOrderDecisions,
  applyActiveOwnerOrderDecision,
} = require('../services/active_owner_order_decisions');
const { guardUnmatchedProduct } = require('../services/unmatched_product_guard');
const { buildWorkingOrder } = require('../services/working_order');

function product(article, overrides = {}) {
  return {
    rowIdentity: `row:${article}:${overrides.row || 1}`,
    article,
    supplier: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ВАЛТА ПЕТ ПРОДАКТС"',
    assortmentPolicy: { matched: false },
    ...overrides,
  };
}

function decisionBase(overrides = {}) {
  return {
    sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":SKU:7173556',
    owner_decision: 'BUY',
    owner_role_override: null,
    owner_policy_override: null,
    owner_order_quantity: 6,
    run_id: 'run-1',
    reason_code: 'MANUAL_EXPERIENCE',
    comment: null,
    reason: 'Ручной опыт владельца',
    decided_at: '2026-08-17T00:44:00.478Z',
    decided_by: 'owner-web-ui',
    status: 'active',
    source_version: 'purchasing-web-owner-decisions-v1',
    idempotency_key: null,
    scope: 'run',
    expires_at: '2026-09-16T00:44:00.478Z',
    original_decision: null,
    original_decision_review_date: null,
    ...overrides,
  };
}

function writeStore(decisions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-order-'));
  const file = path.join(dir, 'decisions.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    store: 'Миска',
    updated_at: '2026-09-11T00:00:00.000Z',
    decisions,
  }));
  return file;
}
test('Zoograd legal entities reuse the same active exact BUY decision', () => {
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:SKU:I306',
    owner_order_quantity: 3,
  })]);
  const current = product('I306', {
    supplier: 'Хабаровск ОПТ',
    rowIdentity: 'row:zoograd-alias:1',
  });
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  const owner = resolved.byRowIdentity.get(current.rowIdentity);
  assert.equal(owner.ownerDecision, 'BUY');
  assert.equal(owner.quantity, 3);
});

test('Rich Store decision never leaks into Zoograd legal entities', () => {
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:РИЧ СТОР ООО:SKU:I306',
    owner_order_quantity: 9,
  })]);
  const current = product('I306', {
    supplier: 'Оникиенко Роман Евгеньевич',
    rowIdentity: 'row:zoograd-no-rich:1',
  });
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.size, 0);
});

test('Valta legal-form alias reuses active exact BUY decision', () => {
  const file = writeStore([decisionBase()]);
  const current = product('7173556');
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  const owner = resolved.byRowIdentity.get(current.rowIdentity);
  assert.equal(owner.ownerDecision, 'BUY');
  assert.equal(owner.quantity, 6);

  const baseDecision = {
    decision: 'manual_review', approvedOrderQuantity: null,
    decisionBasis: 'phase2_calculated', reasons: [], warnings: [], requiredData: [],
  };
  const applied = applyActiveOwnerOrderDecision(current, baseDecision, owner);
  assert.equal(applied.decision.decision, 'must_buy');
  assert.equal(applied.decision.approvedOrderQuantity, 6);
  assert.equal(applied.product.activeOwnerOrderDecision.applied, true);
});

test('missing report article reuses exact owner BUY through matched canonical supplier_sku', () => {
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:АО \"ВАЛТА ПЕТ ПРОДАКТС\":SKU:6201111',
    owner_order_quantity: 2,
  })]);
  const current = product(null, {
    rowIdentity: 'row:alias:1',
    assortmentPolicy: {
      matched: true,
      canonical: { sku_id: 'FOOD-310', supplier_sku: '6201111' },
    },
  });
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  const owner = resolved.byRowIdentity.get(current.rowIdentity);
  assert.equal(owner.ownerDecision, 'BUY');
  assert.equal(owner.quantity, 2);
  assert.equal(owner.identitySource, 'canonical_supplier_sku');
});

test('duplicate canonical supplier_sku is never auto-reused when report article is missing', () => {
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:АО \"ВАЛТА ПЕТ ПРОДАКТС\":SKU:6201111',
    owner_order_quantity: 2,
  })]);
  const canonicalPolicy = {
    matched: true,
    canonical: { sku_id: 'FOOD-310', supplier_sku: '6201111' },
  };
  const products = [
    product(null, { rowIdentity: 'row:alias:1', assortmentPolicy: canonicalPolicy }),
    product(null, { rowIdentity: 'row:alias:2', assortmentPolicy: canonicalPolicy }),
  ];
  const resolved = resolveActiveOwnerOrderDecisions(products, {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.size, 0);
});

test('expired BUY is not reused', () => {
  const file = writeStore([decisionBase()]);
  const current = product('7173556');
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-17T00:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.size, 0);
});
test('duplicate current article is never auto-reused', () => {
  const file = writeStore([decisionBase()]);
  const products = [
    product('7173556', { row: 1 }),
    product('7173556', { row: 2 }),
  ];
  const resolved = resolveActiveOwnerOrderDecisions(products, {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.size, 0);
});

test('active SKIP preserves calculations but suppresses order action', () => {
  const file = writeStore([decisionBase({
    owner_decision: 'SKIP', owner_order_quantity: 0,
  })]);
  const current = product('7173556');
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  const baseDecision = {
    decision: 'must_buy', approvedOrderQuantity: 8,
    decisionBasis: 'phase2_calculated', reasons: [], warnings: [], requiredData: [],
  };
  const applied = applyActiveOwnerOrderDecision(
    { ...current, demandCalculatedQuantity: 8, finalRecommendedQuantity: 8 },
    baseDecision,
    resolved.byRowIdentity.get(current.rowIdentity)
  );
  assert.equal(applied.decision.decision, 'do_not_buy');
  assert.equal(applied.decision.approvedOrderQuantity, 0);
  assert.equal(applied.product.demandCalculatedQuantity, 8);
});
test('active exact BUY bypasses unmatched guard and becomes auto-approved', () => {
  const current = {
    ...product('7173556'),
    analyzerCalculatedQuantity: 7,
    demandCalculatedQuantity: 8,
    finalRecommendedQuantity: 8,
    priceNum: 100,
  };
  const owner = {
    ownerDecision: 'BUY', quantity: 6, applied: true,
    key: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":SKU:7173556',
  };
  const baseDecision = {
    rowIdentity: current.rowIdentity,
    decision: 'manual_review', approvedOrderQuantity: null,
    decisionBasis: 'phase2_calculated', reasons: [], warnings: [], requiredData: [],
  };
  const applied = applyActiveOwnerOrderDecision(current, baseDecision, owner);
  const guarded = guardUnmatchedProduct(applied.product, applied.decision);
  const working = buildWorkingOrder([guarded.product], [guarded.decision]);
  assert.equal(working.products[0].workflowStatus, 'auto_approved');
  assert.equal(working.products[0].approvedOrderQuantity, 6);
});
test('active exact SKIP becomes no-order action without erasing demand evidence', () => {
  const current = {
    ...product('7173556'),
    analyzerCalculatedQuantity: 7,
    demandCalculatedQuantity: 8,
    finalRecommendedQuantity: 8,
    priceNum: 100,
  };
  const owner = { ownerDecision: 'SKIP', quantity: 0, applied: true, key: 'k' };
  const baseDecision = {
    rowIdentity: current.rowIdentity,
    decision: 'must_buy', approvedOrderQuantity: 8,
    decisionBasis: 'phase2_calculated', reasons: [], warnings: [], requiredData: [],
  };
  const applied = applyActiveOwnerOrderDecision(current, baseDecision, owner);
  const guarded = guardUnmatchedProduct(applied.product, applied.decision);
  const working = buildWorkingOrder([guarded.product], [guarded.decision]);
  assert.equal(working.products[0].workflowStatus, 'no_order_action');
  assert.equal(working.products[0].demandCalculatedQuantity, 8);
  assert.equal(working.products[0].approvedOrderQuantity, 0);
});

test('ambiguous assortment remains manual even with an owner marker', () => {
  const current = { ...product('7173556'), demandCalculatedQuantity: 8, finalRecommendedQuantity: 8 };
  const decision = {
    rowIdentity: current.rowIdentity, decision: 'must_buy', approvedOrderQuantity: 6,
    decisionBasis: 'active_owner_order_decision', reasons: [], warnings: [], requiredData: [],
  };
  const guarded = guardUnmatchedProduct(
    { ...current, activeOwnerOrderDecision: { ownerDecision: 'BUY', applied: true } },
    decision,
    [{ candidateRowIdentities: [current.rowIdentity], itemIndex: 1, recordIndex: 1 }]
  );
  assert.equal(guarded.decision.decision, 'manual_review');
  assert.equal(guarded.decision.approvedOrderQuantity, null);
});

test('unique exact product-name fallback reuses active BUY even when current article exists', () => {
  const name = 'Корм Bambini Pets для крыс и мышей, 800 г (34006)';
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":FALLBACK:BAMBINI PETS|КОРМ BAMBINI PETS ДЛЯ КРЫС И МЫШЕЙ, 800 Г (34006)',
    owner_order_quantity: 6,
  })]);
  const current = product('BMPM800', { name });
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  const owner = resolved.byRowIdentity.get(current.rowIdentity);
  assert.equal(owner.ownerDecision, 'BUY');
  assert.equal(owner.quantity, 6);
  assert.equal(owner.identitySource, 'supplier_product_name');
});

test('unique exact product-name fallback reuses active SKIP', () => {
  const name = 'Лакомство Мнямс Пармская косточка для собак размер S 35 г (33043)';
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":FALLBACK:UNKNOWN|ЛАКОМСТВО МНЯМС ПАРМСКАЯ КОСТОЧКА ДЛЯ СОБАК РАЗМЕР S 35 Г (33043)',
    owner_decision: 'SKIP',
    owner_order_quantity: 0,
  })]);
  const current = product('177080', { name });
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.get(current.rowIdentity).ownerDecision, 'SKIP');
});

test('duplicate exact product name blocks fallback reuse', () => {
  const name = 'Одинаковый товар';
  const file = writeStore([decisionBase({
    sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":FALLBACK:UNKNOWN|ОДИНАКОВЫЙ ТОВАР',
    owner_decision: 'SKIP',
    owner_order_quantity: 0,
  })]);
  const products = [
    product('SKU-A', { rowIdentity: 'row:name:1', name }),
    product('SKU-B', { rowIdentity: 'row:name:2', name }),
  ];
  const resolved = resolveActiveOwnerOrderDecisions(products, {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.size, 0);
});

test('exact SKU decision takes precedence over product-name fallback', () => {
  const name = 'Товар с двумя решениями';
  const file = writeStore([
    decisionBase({
      sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":FALLBACK:UNKNOWN|ТОВАР С ДВУМЯ РЕШЕНИЯМИ',
      owner_decision: 'BUY',
      owner_order_quantity: 3,
    }),
    decisionBase({
      sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":SKU:7173556',
      owner_decision: 'SKIP',
      owner_order_quantity: 0,
      decided_at: '2026-08-17T00:45:00.000Z',
      expires_at: '2026-09-16T00:45:00.000Z',
    }),
  ]);
  const current = product('7173556', { name });
  const resolved = resolveActiveOwnerOrderDecisions([current], {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  const owner = resolved.byRowIdentity.get(current.rowIdentity);
  assert.equal(owner.ownerDecision, 'SKIP');
  assert.equal(owner.identitySource, 'article');
});

test('duplicate current article blocks product-name fallback even when names differ', () => {
  const file = writeStore([
    decisionBase({
      sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":FALLBACK:UNKNOWN|ТОВАР А',
      owner_decision: 'SKIP',
      owner_order_quantity: 0,
    }),
    decisionBase({
      sku: 'SUPPLIER:АО "ВАЛТА ПЕТ ПРОДАКТС":FALLBACK:UNKNOWN|ТОВАР Б',
      owner_decision: 'SKIP',
      owner_order_quantity: 0,
      decided_at: '2026-08-17T00:45:00.000Z',
      expires_at: '2026-09-16T00:45:00.000Z',
    }),
  ]);
  const products = [
    product('DUP-1', { rowIdentity: 'row:dup:1', name: 'Товар А' }),
    product('DUP-1', { rowIdentity: 'row:dup:2', name: 'Товар Б' }),
  ];
  const resolved = resolveActiveOwnerOrderDecisions(products, {
    ownerDecisionsPath: file,
    now: '2026-09-11T10:00:00.000Z',
  });
  assert.equal(resolved.byRowIdentity.size, 0);
});
