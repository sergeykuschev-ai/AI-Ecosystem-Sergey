const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  REGISTRY_SCHEMA_VERSION,
  OwnerRuleRegistryError,
  approveProposal,
  buildApprovedRulesMarkdown,
  emptyApprovedRulesRegistry,
  findRuleByProposalId,
  findRuleByStableItemKey,
  loadApprovedRules,
  saveApprovedRules,
} = require('../owner_learning/owner_rule_registry');
const {
  buildOwnerRuleProposals,
} = require('../owner_learning/owner_rule_proposals');
const {
  loadDecisionHistory,
} = require('../owner_learning/owner_decision_history');

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function temporaryRegistryOptions(overrides = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'owner-rule-registry-')
  );
  temporaryDirectories.push(directory);
  return {
    registryPath: path.join(directory, 'owner-approved-rules.json'),
    markdownPath: path.join(directory, 'owner-approved-rules.md'),
    randomSuffix: 'test',
    logger: { error() {} },
    recordDecisionHistory: false,
    ...overrides,
  };
}

function proposal({
  stableItemKey = 'sku:SKU-1',
  name = 'Тестовый товар',
  brand = 'Миска',
  decision = 'SKIP',
} = {}) {
  return buildOwnerRuleProposals({
    reportVersion: 'owner-learning-patterns-v0.2',
    ruleCandidates: [{
      stableItemKey,
      name,
      brand,
      dominantOwnerDecision: decision,
      totalOwnerDecisions: 3,
      dominantDecisionRate: 100,
      consecutiveSameDecisionCount: 3,
      agreementCount: 2,
      overrideCount: 1,
    }],
  }).proposals[0];
}

test('creates an empty registry and Markdown file', () => {
  const options = temporaryRegistryOptions();
  const saved = saveApprovedRules(emptyApprovedRulesRegistry(), options);

  assert.deepEqual(saved, {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: null,
    rules: [],
  });
  assert.deepEqual(loadApprovedRules(options), saved);
  assert.match(
    fs.readFileSync(options.markdownPath, 'utf8'),
    /Пока нет подтверждённых правил\./
  );
});

test('approves the first proposal as an active rule', () => {
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
    notes: 'Подтверждено владельцем',
  });
  const sourceProposal = proposal();
  const rule = approveProposal(sourceProposal, options);

  assert.equal(rule.proposalId, sourceProposal.proposalId);
  assert.equal(rule.approvedDecision, 'SKIP');
  assert.equal(rule.status, 'ACTIVE');
  assert.equal(rule.createdFromVersion, 'owner-rule-proposals-v0.3');
  assert.equal(rule.notes, 'Подтверждено владельцем');
  assert.deepEqual(loadApprovedRules(options).rules, [rule]);
});

test('repeated proposalId returns the existing rule without a duplicate', () => {
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
  });
  const sourceProposal = proposal();
  const first = approveProposal(sourceProposal, options);
  const firstJson = fs.readFileSync(options.registryPath, 'utf8');
  const second = approveProposal(sourceProposal, {
    ...options,
    approvedAt: '2026-07-25T10:00:00.000Z',
  });

  assert.deepEqual(second, first);
  assert.equal(loadApprovedRules(options).rules.length, 1);
  assert.equal(fs.readFileSync(options.registryPath, 'utf8'), firstJson);
});

test('different proposalId values create distinct rules', () => {
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
  });
  const first = approveProposal(proposal(), options);
  const second = approveProposal(proposal({
    stableItemKey: 'sku:SKU-2',
    name: 'Второй товар',
    decision: 'BUY',
  }), {
    ...options,
    approvedAt: '2026-07-25T10:00:00.000Z',
  });

  assert.notEqual(second.proposalId, first.proposalId);
  assert.equal(loadApprovedRules(options).rules.length, 2);
});

test('finds rules by stableItemKey and proposalId', () => {
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
  });
  const sourceProposal = proposal();
  const rule = approveProposal(sourceProposal, options);
  const registry = loadApprovedRules(options);

  assert.deepEqual(
    findRuleByStableItemKey(registry, sourceProposal.stableItemKey),
    rule
  );
  assert.deepEqual(
    findRuleByProposalId(registry, sourceProposal.proposalId),
    rule
  );
  assert.equal(findRuleByProposalId(registry, 'missing'), null);
});

test('corrupted JSON is logged, rejected and never overwritten', () => {
  const messages = [];
  const options = temporaryRegistryOptions({
    logger: { error(message) { messages.push(message); } },
  });
  fs.writeFileSync(options.registryPath, '{ damaged', 'utf8');
  const before = fs.readFileSync(options.registryPath, 'utf8');

  assert.throws(
    () => approveProposal(proposal(), options),
    error =>
      error instanceof OwnerRuleRegistryError &&
      error.code === 'RULE_REGISTRY_CORRUPTED'
  );
  assert.equal(fs.readFileSync(options.registryPath, 'utf8'), before);
  assert.equal(fs.existsSync(options.markdownPath), false);
  assert.match(messages[0], /RULE_REGISTRY_CORRUPTED/);
  assert.doesNotMatch(messages[0], new RegExp(options.registryPath));
});

test('publication uses temporary files, fsync and atomic rename', () => {
  let renameCalls = 0;
  let fsyncCalls = 0;
  const fsModule = {
    ...fs,
    renameSync(...args) {
      renameCalls += 1;
      return fs.renameSync(...args);
    },
    fsyncSync(...args) {
      fsyncCalls += 1;
      return fs.fsyncSync(...args);
    },
  };
  const options = temporaryRegistryOptions({ fsModule });
  saveApprovedRules(emptyApprovedRulesRegistry(), options);

  assert.equal(renameCalls, 2);
  assert.ok(fsyncCalls >= 3);
  assert.deepEqual(
    fs.readdirSync(path.dirname(options.registryPath)).sort(),
    ['owner-approved-rules.json', 'owner-approved-rules.md']
  );
});

test('Markdown without rules has counts and the empty-state text', () => {
  const markdown = buildApprovedRulesMarkdown(
    emptyApprovedRulesRegistry()
  );

  assert.match(markdown, /Количество правил: 0/);
  assert.match(markdown, /Активных: 0/);
  assert.match(markdown, /Отключённых: 0/);
  assert.match(markdown, /Пока нет подтверждённых правил\./);
});

test('Markdown with multiple rules contains the required table', () => {
  const firstProposal = proposal();
  const secondProposal = proposal({
    stableItemKey: 'sku:SKU-2',
    name: 'Второй | товар',
    brand: null,
    decision: 'BUY',
  });
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
  });
  approveProposal(firstProposal, options);
  approveProposal(secondProposal, {
    ...options,
    approvedAt: '2026-07-25T10:00:00.000Z',
  });
  const markdown = fs.readFileSync(options.markdownPath, 'utf8');

  assert.match(markdown, /Количество правил: 2/);
  assert.match(markdown, /\| Название \| Бренд \| Решение \| Статус \|/);
  assert.match(markdown, /Не заказывать/);
  assert.match(markdown, /Заказать/);
  assert.match(markdown, /Второй \\\| товар/);
});

test('invalid proposal is rejected without creating storage', () => {
  const options = temporaryRegistryOptions();

  assert.throws(
    () => approveProposal({ proposalId: 'made-up' }, options),
    error =>
      error instanceof OwnerRuleRegistryError &&
      error.code === 'RULE_REGISTRY_INVALID'
  );
  assert.equal(fs.existsSync(options.registryPath), false);
});

test('approved proposal appends one APPROVED_RULE history entry', () => {
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
    recordDecisionHistory: true,
  });
  options.ownerDecisionHistoryPath = path.join(
    path.dirname(options.registryPath),
    'owner-decision-history.json'
  );
  const sourceProposal = proposal();
  const rule = approveProposal(sourceProposal, options);
  const history = loadDecisionHistory({
    filePath: options.ownerDecisionHistoryPath,
  });

  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].source, 'APPROVED_RULE');
  assert.equal(history.entries[0].stableItemKey, rule.stableItemKey);
  assert.equal(history.entries[0].ownerDecision, rule.approvedDecision);
  assert.equal(history.entries[0].ruleId, rule.ruleId);
  assert.equal(
    history.entries[0].metadata.proposalId,
    sourceProposal.proposalId
  );
});

test('repeated approval does not duplicate decision history', () => {
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
    recordDecisionHistory: true,
  });
  options.ownerDecisionHistoryPath = path.join(
    path.dirname(options.registryPath),
    'owner-decision-history.json'
  );
  const sourceProposal = proposal();

  approveProposal(sourceProposal, options);
  approveProposal(sourceProposal, {
    ...options,
    approvedAt: '2026-07-25T10:00:00.000Z',
  });

  assert.equal(loadDecisionHistory({
    filePath: options.ownerDecisionHistoryPath,
  }).entries.length, 1);
});

test('history failure does not block approval or overwrite history', () => {
  const warnings = [];
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
    recordDecisionHistory: true,
    logger: {
      error() {},
      warn(message) { warnings.push(message); },
    },
  });
  options.ownerDecisionHistoryPath = path.join(
    path.dirname(options.registryPath),
    'owner-decision-history.json'
  );
  fs.writeFileSync(
    options.ownerDecisionHistoryPath,
    '{ damaged history',
    'utf8'
  );
  const before = fs.readFileSync(
    options.ownerDecisionHistoryPath,
    'utf8'
  );

  const rule = approveProposal(proposal(), options);

  assert.equal(rule.status, 'ACTIVE');
  assert.equal(loadApprovedRules(options).rules.length, 1);
  assert.equal(
    fs.readFileSync(options.ownerDecisionHistoryPath, 'utf8'),
    before
  );
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], new RegExp(options.registryPath));
});

test('proposal preview does not create decision history', () => {
  const options = temporaryRegistryOptions({
    recordDecisionHistory: true,
  });
  options.ownerDecisionHistoryPath = path.join(
    path.dirname(options.registryPath),
    'owner-decision-history.json'
  );

  const sourceProposal = proposal();

  assert.equal(sourceProposal.status, 'PENDING');
  assert.equal(fs.existsSync(options.ownerDecisionHistoryPath), false);
});
