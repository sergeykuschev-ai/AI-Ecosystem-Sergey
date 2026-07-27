const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
  loadApprovedRulesTolerant,
  registryFingerprint,
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

test('tolerant read keeps valid neighbors while strict read rejects entries', () => {
  for (const invalidRule of [null, 'bad', []]) {
    const options = temporaryRegistryOptions({
      approvedAt: '2026-07-24T10:00:00.000Z',
    });
    const validRule = approveProposal(proposal(), options);
    const source = {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: '2026-07-24T10:00:00.000Z',
      rules: [invalidRule, validRule],
    };
    const serialized = `${JSON.stringify(source, null, 2)}\n`;
    fs.writeFileSync(options.registryPath, serialized, 'utf8');

    const tolerant = loadApprovedRulesTolerant(options);

    assert.equal(tolerant.rules.length, 2);
    assert.deepEqual(tolerant.rules[0], invalidRule);
    assert.equal(tolerant.rules[1].ruleId, validRule.ruleId);
    assert.throws(
      () => loadApprovedRules(options),
      error =>
        error instanceof OwnerRuleRegistryError &&
        error.code === 'RULE_REGISTRY_INVALID'
    );
    assert.equal(fs.readFileSync(options.registryPath, 'utf8'), serialized);
  }
});

test('tolerant read still rejects an invalid registry envelope', () => {
  for (const source of [
    {
      schemaVersion: 'unsupported',
      updatedAt: null,
      rules: [],
    },
    {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: null,
      rules: {},
    },
  ]) {
    const options = temporaryRegistryOptions();
    fs.writeFileSync(
      options.registryPath,
      `${JSON.stringify(source, null, 2)}\n`,
      'utf8'
    );
    assert.throws(
      () => loadApprovedRulesTolerant(options),
      error =>
        error instanceof OwnerRuleRegistryError &&
        error.code === 'RULE_REGISTRY_INVALID'
    );
  }
});

test('JSON commit succeeds when derived Markdown publication fails', () => {
  const warnings = [];
  const options = temporaryRegistryOptions({
    approvedAt: '2026-07-24T10:00:00.000Z',
  });
  approveProposal(proposal(), options);
  const current = loadApprovedRules(options);
  const markdownBefore = fs.readFileSync(options.markdownPath, 'utf8');
  const fsModule = {
    ...fs,
    renameSync(sourcePath, destinationPath) {
      if (destinationPath === options.markdownPath) {
        const failure = new Error('simulated Markdown failure');
        failure.code = 'EIO';
        throw failure;
      }
      return fs.renameSync(sourcePath, destinationPath);
    },
  };
  const saved = saveApprovedRules({
    ...current,
    updatedAt: '2026-07-25T10:00:00.000Z',
    rules: current.rules.map(rule => ({
      ...rule,
      status: 'DISABLED',
    })),
  }, {
    ...options,
    fsModule,
    expectedFingerprint: registryFingerprint(current),
    logger: {
      error() {},
      warn(message) { warnings.push(message); },
    },
  });

  assert.equal(loadApprovedRules(options).rules[0].status, 'DISABLED');
  assert.deepEqual(saved.publicationWarnings, [
    'RULE_REGISTRY_MARKDOWN_PUBLICATION_FAILED',
  ]);
  assert.equal(fs.readFileSync(options.markdownPath, 'utf8'), markdownBefore);
  assert.match(warnings[0], /RULE_REGISTRY_MARKDOWN_PUBLICATION_FAILED/);
  assert.doesNotMatch(warnings[0], new RegExp(options.registryPath));

  saveApprovedRules(saved, {
    ...options,
    randomSuffix: 'restore',
    expectedFingerprint: registryFingerprint(saved),
  });
  assert.match(
    fs.readFileSync(options.markdownPath, 'utf8'),
    /Отключено/
  );
});

test('expected fingerprint prevents a stale writer from overwriting JSON', () => {
  const options = temporaryRegistryOptions();
  saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const writerA = loadApprovedRules(options);
  const writerB = loadApprovedRules(options);
  const expected = registryFingerprint(writerA);
  saveApprovedRules({
    ...writerA,
    updatedAt: '2026-07-24T10:00:00.000Z',
  }, {
    ...options,
    randomSuffix: 'writer-a',
    expectedFingerprint: expected,
  });
  const afterWriterA = fs.readFileSync(options.registryPath, 'utf8');

  assert.throws(
    () => saveApprovedRules({
      ...writerB,
      updatedAt: '2026-07-25T10:00:00.000Z',
    }, {
      ...options,
      randomSuffix: 'writer-b',
      expectedFingerprint: expected,
    }),
    error =>
      error instanceof OwnerRuleRegistryError &&
      error.code === 'RULE_REGISTRY_CONCURRENT_MODIFICATION'
  );
  assert.equal(
    fs.readFileSync(options.registryPath, 'utf8'),
    afterWriterA
  );
});

test('parallel processes cannot both commit one expected fingerprint', async () => {
  const options = temporaryRegistryOptions();
  saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const expectedFingerprint = registryFingerprint(
    loadApprovedRules(options)
  );
  const modulePath = path.resolve(
    __dirname,
    '../owner_learning/owner_rule_registry.js'
  );
  const markerPath = path.join(
    path.dirname(options.registryPath),
    'writer-a-holds-lock'
  );
  const childSource = [
    'const fs = require("node:fs");',
    'const api = require(process.env.REGISTRY_MODULE);',
    'const registry = {',
    'schemaVersion: api.REGISTRY_SCHEMA_VERSION,',
    'updatedAt: process.env.UPDATED_AT,',
    'rules: []',
    '};',
    'const fsModule = { ...fs, renameSync(source, destination) {',
    'if (process.env.HOLD_LOCK === "1" &&',
    'destination === process.env.REGISTRY_PATH) {',
    'fs.writeFileSync(process.env.MARKER_PATH, "held");',
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);',
    '}',
    'return fs.renameSync(source, destination);',
    '} };',
    'try {',
    'api.saveApprovedRules(registry, {',
    'registryPath: process.env.REGISTRY_PATH,',
    'markdownPath: process.env.MARKDOWN_PATH,',
    'expectedFingerprint: process.env.EXPECTED_FINGERPRINT,',
    'lockTimeoutMs: 1000,',
    'lockRetryMs: 5,',
    'fsModule,',
    'logger: { error() {} }',
    '});',
    'process.stdout.write("SUCCESS");',
    '} catch (error) {',
    'process.stdout.write(error.code || "UNKNOWN");',
    '}',
  ].join('');
  const writer = ({ updatedAt, holdLock }) => {
    const child = spawn(process.execPath, ['-e', childSource], {
      env: {
        ...process.env,
        EXPECTED_FINGERPRINT: expectedFingerprint,
        HOLD_LOCK: holdLock ? '1' : '0',
        MARKDOWN_PATH: options.markdownPath,
        MARKER_PATH: markerPath,
        REGISTRY_MODULE: modulePath,
        REGISTRY_PATH: options.registryPath,
        UPDATED_AT: updatedAt,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    return {
      child,
      result: new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => resolve({ code, stdout, stderr }));
      }),
    };
  };
  const writerA = writer({
    updatedAt: '2026-07-24T10:00:00.000Z',
    holdLock: true,
  });
  const markerDeadline = Date.now() + 2000;
  while (!fs.existsSync(markerPath) && Date.now() < markerDeadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(fs.existsSync(markerPath), true);
  const writerB = writer({
    updatedAt: '2026-07-25T10:00:00.000Z',
    holdLock: false,
  });
  const [resultA, resultB] = await Promise.all([
    writerA.result,
    writerB.result,
  ]);

  assert.deepEqual(
    [resultA.stdout, resultB.stdout].sort(),
    ['RULE_REGISTRY_CONCURRENT_MODIFICATION', 'SUCCESS']
  );
  assert.equal(resultA.code, 0, resultA.stderr);
  assert.equal(resultB.code, 0, resultB.stderr);
  assert.equal(
    loadApprovedRules(options).updatedAt,
    '2026-07-24T10:00:00.000Z'
  );
  assert.equal(fs.existsSync(`${options.registryPath}.lock`), false);
});

test('two stale reclaimers preserve the fresh winner lock and one JSON', async () => {
  const options = temporaryRegistryOptions();
  saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const expectedFingerprint = registryFingerprint(
    loadApprovedRules(options)
  );
  const lockPath = `${options.registryPath}.lock`;
  const staleLockId = '11111111111111111111111111111111';
  fs.writeFileSync(lockPath, `${JSON.stringify({
    lockId: staleLockId,
    pid: 2_147_483_647,
    createdAt: '2026-07-24T00:00:00.000Z',
  })}\n`, 'utf8');
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, staleTime, staleTime);
  const modulePath = path.resolve(
    __dirname,
    '../owner_learning/owner_rule_registry.js'
  );
  const goPath = path.join(path.dirname(lockPath), 'reclaim-go');
  const childSource = [
    'const fs = require("node:fs");',
    'const api = require(process.env.REGISTRY_MODULE);',
    'let synchronized = false;',
    'const fsModule = { ...fs,',
    'readFileSync(filePath, ...args) {',
    'const value = fs.readFileSync(filePath, ...args);',
    'if (!synchronized && filePath === process.env.LOCK_PATH &&',
    'String(value).includes(process.env.STALE_LOCK_ID)) {',
    'synchronized = true;',
    'fs.writeFileSync(process.env.READY_PATH, "ready");',
    'while (!fs.existsSync(process.env.GO_PATH)) {',
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);',
    '}',
    '}',
    'return value;',
    '},',
    'renameSync(source, destination) {',
    'if (destination === process.env.REGISTRY_PATH) {',
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);',
    '}',
    'return fs.renameSync(source, destination);',
    '}',
    '};',
    'try {',
    'api.saveApprovedRules({',
    'schemaVersion: api.REGISTRY_SCHEMA_VERSION,',
    'updatedAt: process.env.UPDATED_AT,',
    'rules: []',
    '}, {',
    'registryPath: process.env.REGISTRY_PATH,',
    'markdownPath: process.env.MARKDOWN_PATH,',
    'expectedFingerprint: process.env.EXPECTED_FINGERPRINT,',
    'lockStaleMs: 10,',
    'lockTimeoutMs: 1500,',
    'lockRetryMs: 5,',
    'fsModule,',
    'logger: { error() {} }',
    '});',
    'process.stdout.write("SUCCESS");',
    '} catch (error) {',
    'process.stdout.write(error.code || "UNKNOWN");',
    '}',
  ].join('');
  const children = [
    ['2026-07-24T10:00:00.000Z', 'reclaimer-a-ready'],
    ['2026-07-25T10:00:00.000Z', 'reclaimer-b-ready'],
  ].map(([updatedAt, markerName]) => {
    const readyPath = path.join(path.dirname(lockPath), markerName);
    const child = spawn(process.execPath, ['-e', childSource], {
      env: {
        ...process.env,
        EXPECTED_FINGERPRINT: expectedFingerprint,
        GO_PATH: goPath,
        LOCK_PATH: lockPath,
        MARKDOWN_PATH: options.markdownPath,
        READY_PATH: readyPath,
        REGISTRY_MODULE: modulePath,
        REGISTRY_PATH: options.registryPath,
        STALE_LOCK_ID: staleLockId,
        UPDATED_AT: updatedAt,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    return {
      readyPath,
      result: new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => resolve({ code, stdout, stderr }));
      }),
    };
  });
  const readyDeadline = Date.now() + 3000;
  while (
    children.some(child => !fs.existsSync(child.readyPath)) &&
    Date.now() < readyDeadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(
    children.every(child => fs.existsSync(child.readyPath)),
    true
  );
  fs.writeFileSync(goPath, 'go', 'utf8');
  const results = await Promise.all(
    children.map(child => child.result)
  );

  assert.deepEqual(
    results.map(result => result.stdout).sort(),
    ['RULE_REGISTRY_CONCURRENT_MODIFICATION', 'SUCCESS']
  );
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
  }
  assert.ok([
    '2026-07-24T10:00:00.000Z',
    '2026-07-25T10:00:00.000Z',
  ].includes(loadApprovedRules(options).updatedAt));
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(
    fs.readdirSync(path.dirname(lockPath))
      .some(name => name.includes('.lock.reclaim-')),
    false
  );
});

test('stale registry lock is removed before a protected write', () => {
  const options = temporaryRegistryOptions();
  const initial = saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const lockPath = `${options.registryPath}.lock`;
  fs.writeFileSync(lockPath, '{"lockId":"stale"}\n', 'utf8');
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, staleTime, staleTime);

  saveApprovedRules({
    ...initial,
    updatedAt: '2026-07-24T10:00:00.000Z',
  }, {
    ...options,
    expectedFingerprint: registryFingerprint(initial),
    lockStaleMs: 10,
  });

  assert.equal(
    loadApprovedRules(options).updatedAt,
    '2026-07-24T10:00:00.000Z'
  );
  assert.equal(fs.existsSync(lockPath), false);
});

test('fresh registry lock times out without blocking strict reads', () => {
  const options = temporaryRegistryOptions();
  const initial = saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const lockPath = `${options.registryPath}.lock`;
  fs.writeFileSync(lockPath, '{"lockId":"active"}\n', 'utf8');

  assert.deepEqual(loadApprovedRules(options), initial);
  assert.throws(
    () => saveApprovedRules({
      ...initial,
      updatedAt: '2026-07-24T10:00:00.000Z',
    }, {
      ...options,
      expectedFingerprint: registryFingerprint(initial),
      lockTimeoutMs: 20,
      lockRetryMs: 5,
      lockStaleMs: 10_000,
    }),
    error =>
      error instanceof OwnerRuleRegistryError &&
      error.code === 'RULE_REGISTRY_WRITE_LOCKED'
  );
  assert.deepEqual(loadApprovedRules(options), initial);
  assert.equal(fs.existsSync(lockPath), true);
});

test('release removes only its own lockId and preserves a foreign lock', () => {
  const options = temporaryRegistryOptions();
  const initial = saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const lockPath = `${options.registryPath}.lock`;
  const foreignLock = {
    lockId: '22222222222222222222222222222222',
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  const fsModule = {
    ...fs,
    renameSync(sourcePath, destinationPath) {
      const result = fs.renameSync(sourcePath, destinationPath);
      if (destinationPath === options.registryPath) {
        fs.writeFileSync(
          lockPath,
          `${JSON.stringify(foreignLock)}\n`,
          'utf8'
        );
      }
      return result;
    },
  };

  assert.throws(
    () => saveApprovedRules({
      ...initial,
      updatedAt: '2026-07-24T10:00:00.000Z',
    }, {
      ...options,
      fsModule,
      expectedFingerprint: registryFingerprint(initial),
    }),
    error =>
      error instanceof OwnerRuleRegistryError &&
      error.code === 'RULE_REGISTRY_WRITE_LOCKED'
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(lockPath, 'utf8')),
    foreignLock
  );
  assert.equal(
    loadApprovedRules(options).updatedAt,
    '2026-07-24T10:00:00.000Z'
  );
});

test('registry lock is cleaned after authoritative JSON write failure', () => {
  const options = temporaryRegistryOptions();
  const initial = saveApprovedRules(emptyApprovedRulesRegistry(), options);
  const fsModule = {
    ...fs,
    renameSync(sourcePath, destinationPath) {
      if (destinationPath === options.registryPath) {
        throw Object.assign(new Error('simulated'), { code: 'EIO' });
      }
      return fs.renameSync(sourcePath, destinationPath);
    },
  };

  assert.throws(
    () => saveApprovedRules({
      ...initial,
      updatedAt: '2026-07-24T10:00:00.000Z',
    }, {
      ...options,
      fsModule,
      expectedFingerprint: registryFingerprint(initial),
    }),
    { code: 'RULE_REGISTRY_WRITE_FAILED' }
  );
  assert.equal(fs.existsSync(`${options.registryPath}.lock`), false);
  assert.deepEqual(loadApprovedRules(options), initial);
});

test('legacy direct save may only repeat an existing registry unchanged', () => {
  const options = temporaryRegistryOptions();
  const initial = saveApprovedRules(emptyApprovedRulesRegistry(), options);
  assert.deepEqual(saveApprovedRules(initial, {
    ...options,
    randomSuffix: 'same',
  }), initial);

  assert.throws(
    () => saveApprovedRules({
      ...initial,
      updatedAt: '2026-07-24T10:00:00.000Z',
    }, {
      ...options,
      randomSuffix: 'unsafe-overwrite',
    }),
    error =>
      error instanceof OwnerRuleRegistryError &&
      error.code === 'RULE_REGISTRY_CONCURRENT_MODIFICATION'
  );
  assert.deepEqual(loadApprovedRules(options), initial);
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
