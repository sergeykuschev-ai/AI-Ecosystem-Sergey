const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  STATUS_EVENTS_SCHEMA_VERSION,
  appendRuleStatusEvent,
  createRuleStatusEvent,
  getCurrentRuleStatusHistory,
  loadRuleStatusEvents,
  summarizeRuleStatusEvents,
  validateRuleStatusTransition,
} = require('../owner_learning/owner_rule_status_manager');

const directories = [];
const NOW = '2026-07-26T02:00:00.000Z';

afterEach(() => {
  while (directories.length) {
    fs.rmSync(directories.pop(), { recursive: true, force: true });
  }
});

function materializedRule(overrides = {}) {
  return {
    ruleId: 'rule-safe-1',
    proposalId: 'proposal-safe-1',
    stableItemKey: 'sku:SKU-1',
    name: 'Test product',
    brand: null,
    ruleType: 'ITEM_DECISION_OVERRIDE',
    approvedDecision: 'SKIP',
    approvedAt: NOW,
    status: 'DISABLED',
    createdFromVersion: 'owner-rule-materialization-v0.9.0',
    notes: null,
    scopeType: 'ITEM',
    scopeKey: 'sku:SKU-1',
    action: {
      decision: 'SKIP',
      quantityStrategy: 'NO_QUANTITY_CHANGE',
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: NOW,
    updatedAt: NOW,
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId: 'candidate-safe-1',
    },
    ...overrides,
  };
}

function previewSnapshot(overrides = {}) {
  return {
    previewId: 'preview-safe-1',
    previewedAt: NOW,
    ruleId: 'rule-safe-1',
    currentRuleStatus: 'DISABLED',
    targetRuleStatus: 'ACTIVE',
    affectedItems: 1,
    affectedRows: 1,
    decisionChanges: 1,
    quantityChanges: 1,
    orderAmountBefore: 50,
    orderAmountAfter: 0,
    orderAmountDelta: -50,
    unitsBefore: 5,
    unitsAfter: 0,
    unitsDelta: -5,
    financialStatusBefore: 'APPROVED',
    financialStatusAfter: 'APPROVED',
    financiallyPermitted: true,
    warnings: [],
    ...overrides,
  };
}

function eventInput(overrides = {}) {
  return {
    rule: materializedRule(),
    targetStatus: 'ACTIVE',
    recordedAt: NOW,
    confirmation: true,
    reasonCode: 'READY_TO_APPLY',
    ownerComment: 'Проверено владельцем',
    previewSnapshot: previewSnapshot(),
    metadata: { transitionSource: 'OWNER_RULE_STATUS_API' },
    ...overrides,
  };
}

function temporaryFile() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-rule-status-')
  );
  directories.push(directory);
  return path.join(directory, 'events.json');
}

test('validates DISABLED → ACTIVE', () => {
  const transition = validateRuleStatusTransition({
    rule: materializedRule(),
    targetStatus: 'ACTIVE',
  });
  assert.equal(transition.action, 'ACTIVATE');
  assert.equal(transition.fromStatus, 'DISABLED');
  assert.equal(transition.toStatus, 'ACTIVE');
});

test('validates ACTIVE → DISABLED', () => {
  const transition = validateRuleStatusTransition({
    rule: materializedRule({ status: 'ACTIVE' }),
    targetStatus: 'DISABLED',
  });
  assert.equal(transition.action, 'DEACTIVATE');
});

for (const [status, targetStatus] of [
  ['ACTIVE', 'ACTIVE'],
  ['DISABLED', 'DISABLED'],
  ['DISABLED', 'UNKNOWN'],
]) {
  test(`rejects ${status} → ${targetStatus}`, () => {
    assert.throws(
      () => validateRuleStatusTransition({
        rule: materializedRule({ status }),
        targetStatus,
      }),
      { code: 'OWNER_RULE_STATUS_TRANSITION_INVALID' }
    );
  });
}

test('rejects legacy and non-materialized rules', () => {
  assert.throws(
    () => validateRuleStatusTransition({
      rule: materializedRule({
        ruleType: 'ITEM_DECISION',
        source: undefined,
        provenance: undefined,
      }),
      targetStatus: 'ACTIVE',
    }),
    { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
  );
  assert.throws(
    () => validateRuleStatusTransition({
      rule: materializedRule({
        source: 'MANUAL',
        provenance: {
          source: 'MANUAL',
          candidateId: 'candidate-safe-1',
        },
      }),
      targetStatus: 'ACTIVE',
    }),
    { code: 'OWNER_RULE_STATUS_TRANSITION_INVALID' }
  );
});

test('eventId is deterministic and inputs are not mutated', () => {
  const input = eventInput();
  const before = structuredClone(input);
  const first = createRuleStatusEvent(input);
  const second = createRuleStatusEvent(structuredClone(input));
  assert.equal(first.eventId, second.eventId);
  assert.deepEqual(input, before);
  assert.equal(first.schemaVersion, STATUS_EVENTS_SCHEMA_VERSION);
  assert.match(first.ruleSnapshot.stableItemKeyHash, /^[0-9a-f]{64}$/);
  assert.equal(first.ruleSnapshot.stableItemKey, undefined);
});

test('requires confirmation and preview', () => {
  assert.throws(
    () => createRuleStatusEvent(eventInput({ confirmation: false })),
    { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
  );
  assert.throws(
    () => createRuleStatusEvent(eventInput({
      previewSnapshot: null,
    })),
    { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
  );
});

test('rejects long comment and unsafe metadata', () => {
  assert.throws(
    () => createRuleStatusEvent(eventInput({
      ownerComment: 'x'.repeat(1001),
    })),
    { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
  );
  assert.throws(
    () => createRuleStatusEvent(eventInput({
      metadata: { absolutePath: '/private/tmp/secret' },
    })),
    { code: 'OWNER_RULE_STATUS_INVALID_INPUT' }
  );
});

test('append is atomic and duplicate does not rewrite the file', () => {
  const filePath = temporaryFile();
  const event = createRuleStatusEvent(eventInput());
  const first = appendRuleStatusEvent({ filePath, event });
  assert.equal(first.added, true);
  const before = fs.readFileSync(filePath, 'utf8');
  const duplicate = appendRuleStatusEvent({ filePath, event });
  assert.equal(duplicate.added, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)).filter(name =>
      name.endsWith('.tmp')
    ),
    []
  );
});

test('missing journal loads the initial schema', () => {
  const journal = loadRuleStatusEvents({ filePath: temporaryFile() });
  assert.deepEqual(journal, {
    schemaVersion: STATUS_EVENTS_SCHEMA_VERSION,
    updatedAt: null,
    events: [],
  });
});

test('corrupted journal is not overwritten', () => {
  const filePath = temporaryFile();
  fs.writeFileSync(filePath, '{broken', 'utf8');
  assert.throws(
    () => appendRuleStatusEvent({
      filePath,
      event: createRuleStatusEvent(eventInput()),
    }),
    { code: 'OWNER_RULE_STATUS_STORAGE_CORRUPTED' }
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});

test('unsupported journal schema blocks append', () => {
  const filePath = temporaryFile();
  const source = '{"schemaVersion":"future","updatedAt":null,"events":[]}';
  fs.writeFileSync(filePath, source, 'utf8');
  assert.throws(
    () => appendRuleStatusEvent({
      filePath,
      event: createRuleStatusEvent(eventInput()),
    }),
    { code: 'OWNER_RULE_STATUS_SCHEMA_UNSUPPORTED' }
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), source);
});

test('history and summary are deterministic', () => {
  const activation = createRuleStatusEvent(eventInput());
  const activeRule = materializedRule({
    status: 'ACTIVE',
    updatedAt: '2026-07-26T02:01:00.000Z',
  });
  const deactivation = createRuleStatusEvent(eventInput({
    rule: activeRule,
    targetStatus: 'DISABLED',
    recordedAt: '2026-07-26T02:02:00.000Z',
    reasonCode: 'TEMPORARILY_DISABLE',
    previewSnapshot: previewSnapshot({
      previewId: 'preview-safe-2',
      previewedAt: '2026-07-26T02:01:00.000Z',
      currentRuleStatus: 'ACTIVE',
      targetRuleStatus: 'DISABLED',
    }),
  }));
  const events = [deactivation, activation];
  const history = getCurrentRuleStatusHistory({
    events,
    ruleId: 'rule-safe-1',
  });
  assert.deepEqual(
    history.map(event => event.action),
    ['ACTIVATE', 'DEACTIVATE']
  );
  assert.deepEqual(summarizeRuleStatusEvents(events), {
    totalEvents: 2,
    activations: 1,
    deactivations: 1,
    affectedRules: 1,
    lastStatusChangeAt: '2026-07-26T02:02:00.000Z',
    lastStatusAction: 'DEACTIVATE',
  });
});
