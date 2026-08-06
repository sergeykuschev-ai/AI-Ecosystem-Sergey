'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyOwnerDecisionMigrationPlan,
  buildOwnerDecisionMigrationPlan,
} = require('../services/owner_decision_identity');

function rowIdKey(hash = 'E3B693') {
  return `SMARTZAPAS:${hash}:%D0%9B%D0%B8%D1%81%D1%82_1:6`;
}

function decision(overrides = {}) {
  return {
    sku: rowIdKey(),
    owner_decision: 'SKIP',
    owner_role_override: null,
    owner_policy_override: null,
    owner_order_quantity: 0,
    run_id: null,
    reason_code: null,
    comment: null,
    reason: 'Владелец исключил товар из текущей закупки.',
    decided_at: '2026-07-31T04:03:19.435Z',
    decided_by: 'owner-web-ui',
    status: 'active',
    source_version: 'purchasing-web-owner-decisions-v1',
    ...overrides,
  };
}

function historyEntry(overrides = {}) {
  return {
    schemaVersion: 'owner-decision-history-v0.7.1',
    decisionId: `owner-decision-${Math.random().toString(36).slice(2)}`,
    recordedAt: '2026-07-31T04:03:19.435Z',
    source: 'OWNER_REVIEW',
    runId: 'f9b7f051-0b12-4128-a87b-61a987d24b04',
    supplier: 'ЗООГРАД-ХАБАРОВСК ООО',
    stableItemKey: `row:smartzapas:e3b693:%d0%bb%d0%b8%d1%81%d1%82_1:6`,
    sku: '00-00006177',
    barcode: null,
    productName: 'дал',
    brand: null,
    agentRecommendation: null,
    agentQuantity: 0,
    ownerDecision: 'SKIP',
    ownerQuantity: 0,
    decidedBy: 'owner-web-ui',
    reasonCode: 'NOT_SPECIFIED',
    ownerComment: null,
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {},
    inventoryContext: {},
    salesContext: {},
    metadata: {},
    ...overrides,
  };
}

function decisionsMemory(decisions) {
  return { version: 1, store: 'Миска', updated_at: null, decisions };
}

function decisionHistory(entries) {
  return { schemaVersion: 'owner-decision-history-v0.7.1', updatedAt: null, entries };
}

test('supplier + SKU decision is migrated', () => {
  const d = decision();
  const h = historyEntry();
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([h])
  );

  assert.equal(plan.migrated.length, 1);
  assert.equal(plan.migrated[0].oldKey, d.sku);
  assert.equal(plan.migrated[0].newKey, 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:SKU:00-00006177');
  assert.equal(plan.migrated[0].matchMethod, 'supplier_sku');
  assert.equal(plan.migrated[0].newDecision.owner_decision, 'SKIP');
  assert.equal(plan.migrated[0].newDecision.status, 'active');
});

test('supplier + barcode decision is migrated when SKU is absent', () => {
  const d = decision();
  const h = historyEntry({ sku: null, barcode: '460000000001' });
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([h])
  );

  assert.equal(plan.migrated.length, 1);
  assert.equal(plan.migrated[0].newKey, 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:BARCODE:460000000001');
  assert.equal(plan.migrated[0].matchMethod, 'supplier_barcode');
});

test('supplier + productName decision is migrated on exact unique match', () => {
  const d = decision();
  const h = historyEntry({ sku: null, barcode: null, productName: 'Unique Product' });
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([h])
  );

  assert.equal(plan.migrated.length, 1);
  assert.equal(plan.migrated[0].newKey, 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:FALLBACK:UNKNOWN|UNIQUE PRODUCT');
  assert.equal(plan.migrated[0].matchMethod, 'supplier_product_name');
});

test('duplicate productName for same supplier produces conflict, not migration', () => {
  const first = decision({ sku: rowIdKey('AAA') });
  const second = decision({ sku: rowIdKey('BBB'), owner_decision: 'BUY', owner_order_quantity: 5 });
  const history = decisionHistory([
    historyEntry({ stableItemKey: 'row:smartzapas:aaa:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: null, barcode: null, productName: 'Shared Name' }),
    historyEntry({ stableItemKey: 'row:smartzapas:bbb:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: null, barcode: null, productName: 'Shared Name' }),
  ]);

  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([first, second]),
    history
  );

  assert.equal(plan.migrated.length, 0);
  assert.equal(plan.conflicts.length, 2);
  assert.ok(plan.conflicts.every(c =>
    c.reason === 'supplier-product-name-not-unique-in-history'
  ));
});

test('existing equivalent newKey is deduplicated, not overwritten', () => {
  const existing = {
    ...decision(),
    sku: 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:SKU:00-00006177',
  };
  const old = decision();
  const h = historyEntry();

  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([existing, old]),
    decisionHistory([h])
  );

  assert.equal(plan.migrated.length, 0);
  assert.equal(plan.unchanged.filter(item => item.oldKey === old.sku).length, 1);
  const deduplicated = plan.unchanged.find(item => item.oldKey === old.sku);
  assert.equal(deduplicated.newKey, existing.sku);
  assert.equal(deduplicated.reason, 'target-key-already-has-equivalent-decision');
});

test('existing different newKey produces conflict', () => {
  const existing = {
    ...decision(),
    sku: 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:SKU:00-00006177',
    owner_decision: 'BUY',
    owner_order_quantity: 7,
  };
  const old = decision();
  const h = historyEntry();

  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([existing, old]),
    decisionHistory([h])
  );

  assert.equal(plan.migrated.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].reason, 'target-key-exists-with-different-decision');
});

test('migration preserves decision, quantity, reason and timestamps in audit metadata', () => {
  const d = decision({ owner_decision: 'BUY', owner_order_quantity: 3, reason_code: 'CUSTOMER_REQUEST' });
  const h = historyEntry();
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([h])
  );

  const migrated = plan.migrated[0].newDecision;
  assert.equal(migrated.owner_decision, 'BUY');
  assert.equal(migrated.owner_order_quantity, 3);
  assert.equal(migrated.reason_code, 'CUSTOMER_REQUEST');
  assert.equal(migrated.decided_at, d.decided_at);
  assert.equal(migrated.status, 'active');
  assert.equal(migrated.migration_metadata.old_key, d.sku);
  assert.equal(migrated.migration_metadata.match_method, 'supplier_sku');
  assert.ok(typeof migrated.migration_metadata.migrated_at === 'string');
});

test('input objects are never mutated', () => {
  const d = decision();
  const h = historyEntry();
  const memory = decisionsMemory([d]);
  const history = decisionHistory([h]);
  const memorySnapshot = JSON.stringify(memory);
  const historySnapshot = JSON.stringify(history);

  buildOwnerDecisionMigrationPlan(memory, history);
  applyOwnerDecisionMigrationPlan(
    buildOwnerDecisionMigrationPlan(memory, history),
    { dryRun: false, decisionsMemory: memory }
  );

  assert.equal(JSON.stringify(memory), memorySnapshot);
  assert.equal(JSON.stringify(history), historySnapshot);
});

test('dry-run does not write files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-migration-dry-run-'));
  const filePath = path.join(directory, 'decisions.json');
  fs.writeFileSync(filePath, JSON.stringify(decisionsMemory([])), 'utf8');

  try {
    const d = decision();
    const h = historyEntry();
    const memory = decisionsMemory([d]);
    const plan = buildOwnerDecisionMigrationPlan(memory, decisionHistory([h]));

    const result = applyOwnerDecisionMigrationPlan(plan, {
      dryRun: true,
      filePath,
      fsModule: fs,
      decisionsMemory: memory,
    });

    assert.equal(result.dryRun, true);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), JSON.stringify(decisionsMemory([])));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('non-dry-run produces new decisions memory without writing when filePath is omitted', () => {
  const d = decision();
  const h = historyEntry();
  const memory = decisionsMemory([d]);
  const plan = buildOwnerDecisionMigrationPlan(memory, decisionHistory([h]));

  const result = applyOwnerDecisionMigrationPlan(plan, {
    dryRun: false,
    decisionsMemory: memory,
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.decisionsMemory.decisions.length, 1);
  assert.equal(result.decisionsMemory.decisions[0].sku, plan.migrated[0].newKey);
});

test('inactive decisions are skipped', () => {
  const d = { ...decision(), status: 'inactive' };
  const h = historyEntry();
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([h])
  );

  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, 'inactive-decision');
});

test('already supported keys remain unchanged', () => {
  const legacy = { ...decision(), sku: 'LEGACY-SKU' };
  const modern = { ...decision(), sku: 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:SKU:00-00006177' };
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([legacy, modern]),
    decisionHistory([])
  );

  assert.equal(plan.unchanged.length, 2);
  assert.equal(plan.migrated.length, 0);
});

test('rowId decision without matching history is skipped', () => {
  const d = decision();
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([])
  );

  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, 'no-matching-history-entry');
});

test('short or empty productName is not used for migration', () => {
  const d = decision();
  const h = historyEntry({ sku: null, barcode: null, productName: 'AB' });
  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([d]),
    decisionHistory([h])
  );

  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, 'no-unique-usable-identity-in-history');
});

test('multiple equivalent source decisions targeting same key are deduplicated', () => {
  const first = decision({ sku: rowIdKey('AAA') });
  const second = decision({ sku: rowIdKey('BBB') });
  const history = decisionHistory([
    historyEntry({ stableItemKey: 'row:smartzapas:aaa:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: '00-00006177' }),
    historyEntry({ stableItemKey: 'row:smartzapas:bbb:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: '00-00006177' }),
  ]);

  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([first, second]),
    history
  );

  assert.equal(plan.migrated.length, 1);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0].reason, 'source-group-equivalent-decision-deduplicated');
  assert.equal(plan.conflicts.length, 0);
});

test('duplicate productName for same supplier with equivalent decisions deduplicates', () => {
  const first = decision({ sku: rowIdKey('AAA') });
  const second = decision({ sku: rowIdKey('BBB') });
  const history = decisionHistory([
    historyEntry({ stableItemKey: 'row:smartzapas:aaa:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: null, barcode: null, productName: 'Shared Name' }),
    historyEntry({ stableItemKey: 'row:smartzapas:bbb:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: null, barcode: null, productName: 'Shared Name' }),
  ]);

  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([first, second]),
    history
  );

  assert.equal(plan.migrated.length, 1);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.conflicts.length, 0);
});

test('existing equivalent decision deduplicates all equivalent source decisions', () => {
  const existing = {
    ...decision(),
    sku: 'SUPPLIER:ЗООГРАД-ХАБАРОВСК ООО:SKU:00-00006177',
  };
  const first = decision({ sku: rowIdKey('AAA') });
  const second = decision({ sku: rowIdKey('BBB') });
  const history = decisionHistory([
    historyEntry({ stableItemKey: 'row:smartzapas:aaa:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: '00-00006177' }),
    historyEntry({ stableItemKey: 'row:smartzapas:bbb:%d0%bb%d0%b8%d1%81%d1%82_1:6', sku: '00-00006177' }),
  ]);

  const plan = buildOwnerDecisionMigrationPlan(
    decisionsMemory([existing, first, second]),
    history
  );

  assert.equal(plan.migrated.length, 0);
  assert.equal(plan.unchanged.length, 3);
  const deduplicated = plan.unchanged.filter(item =>
    item.oldKey === first.sku || item.oldKey === second.sku
  );
  assert.equal(deduplicated.length, 2);
  assert.ok(deduplicated.every(item => item.reason === 'target-key-already-has-equivalent-decision'));
});
