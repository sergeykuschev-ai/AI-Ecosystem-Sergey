const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  REPORT_VERSION: PROPOSALS_VERSION,
  buildProposalId,
} = require('./owner_rule_proposals');
const {
  DEFAULT_HISTORY_PATH,
} = require('./owner_decision_history');
const {
  recordOwnerDecisionHistory,
} = require('./owner_decision_history_recorder');

const REGISTRY_SCHEMA_VERSION = 'owner-approved-rules-v0.4';
const DEFAULT_REGISTRY_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/owner-approved-rules.json'
);
const DEFAULT_MARKDOWN_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/owner-approved-rules.md'
);
const RULE_TYPE = 'ITEM_DECISION';
const RULE_STATUSES = new Set(['ACTIVE', 'DISABLED']);
const SUPPORTED_DECISIONS = new Set(['BUY', 'SKIP', 'DEFER']);
const DECISION_LABELS = Object.freeze({
  BUY: 'Заказать',
  SKIP: 'Не заказывать',
  DEFER: 'Отложить',
});
const STATUS_LABELS = Object.freeze({
  ACTIVE: 'Активно',
  DISABLED: 'Отключено',
});
const DEFAULT_WRITE_LOCK_TIMEOUT_MS = 1000;
const DEFAULT_WRITE_LOCK_STALE_MS = 30_000;
const DEFAULT_WRITE_LOCK_RETRY_MS = 10;

class OwnerRuleRegistryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'OwnerRuleRegistryError';
    this.code = code;
  }
}

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function requiredString(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      `Owner Rule Registry: поле ${fieldName} обязательно.`
    );
  }
  return normalized;
}

function validIsoDate(value) {
  return Boolean(
    optionalString(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function optionalMaterializationFields(value) {
  const hasMaterializationFields = [
    'scopeType',
    'scopeKey',
    'action',
    'source',
    'createdAt',
    'updatedAt',
    'provenance',
  ].some(field => value[field] !== undefined);
  if (!hasMaterializationFields) return {};
  if (
    value.source !== 'OWNER_LEARNING_CANDIDATE' ||
    value.scopeType !== 'ITEM' ||
    value.scopeKey !== value.stableItemKey ||
    !validIsoDate(value.createdAt) ||
    !validIsoDate(value.updatedAt) ||
    !value.action ||
    typeof value.action !== 'object' ||
    Array.isArray(value.action) ||
    !value.provenance ||
    typeof value.provenance !== 'object' ||
    Array.isArray(value.provenance)
  ) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: materialization-поля некорректны.'
    );
  }
  const decision = requiredString(
    value.action.decision,
    'action.decision'
  ).toUpperCase();
  const quantityStrategy = requiredString(
    value.action.quantityStrategy,
    'action.quantityStrategy'
  ).toUpperCase();
  if (
    decision !== value.approvedDecision ||
    !SUPPORTED_DECISIONS.has(decision) ||
    quantityStrategy !== (
      decision === 'BUY'
        ? 'KEEP_AGENT_QUANTITY'
        : 'NO_QUANTITY_CHANGE'
    ) ||
    value.action.quantityValue !== null ||
    !RULE_STATUSES.has(value.status)
  ) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: materialized rule небезопасен.'
    );
  }
  const provenance = value.provenance;
  if (
    provenance.source !== 'OWNER_LEARNING_CANDIDATE' ||
    provenance.candidateId === undefined ||
    provenance.lifecycleEventId === undefined ||
    provenance.patternType !== 'SAME_ITEM_SAME_DECISION' ||
    provenance.eligibilityStatus !== 'ELIGIBLE' ||
    !validIsoDate(provenance.materializedAt) ||
    !Number.isInteger(provenance.confidenceScore) ||
    provenance.confidenceScore < 0 ||
    provenance.confidenceScore > 100 ||
    !Number.isInteger(provenance.priorityScore) ||
    provenance.priorityScore < 0 ||
    provenance.priorityScore > 100
  ) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: provenance materialization некорректен.'
    );
  }
  return {
    scopeType: 'ITEM',
    scopeKey: value.stableItemKey,
    action: {
      decision,
      quantityStrategy,
      quantityValue: null,
    },
    source: 'OWNER_LEARNING_CANDIDATE',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    provenance: {
      source: 'OWNER_LEARNING_CANDIDATE',
      candidateId: requiredString(
        provenance.candidateId,
        'provenance.candidateId'
      ),
      lifecycleEventId: requiredString(
        provenance.lifecycleEventId,
        'provenance.lifecycleEventId'
      ),
      patternType: 'SAME_ITEM_SAME_DECISION',
      confidenceScore: provenance.confidenceScore,
      confidenceLevel: requiredString(
        provenance.confidenceLevel,
        'provenance.confidenceLevel'
      ),
      priorityScore: provenance.priorityScore,
      priorityLevel: requiredString(
        provenance.priorityLevel,
        'provenance.priorityLevel'
      ),
      eligibilityStatus: 'ELIGIBLE',
      materializedAt: provenance.materializedAt,
      materializationVersion: requiredString(
        provenance.materializationVersion,
        'provenance.materializationVersion'
      ),
    },
  };
}

function emptyApprovedRulesRegistry() {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: null,
    rules: [],
  };
}

function validateRule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry содержит некорректное правило.'
    );
  }
  const status = requiredString(value.status, 'status').toUpperCase();
  const approvedDecision = requiredString(
    value.approvedDecision,
    'approvedDecision'
  ).toUpperCase();
  if (!RULE_STATUSES.has(status)) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      `Owner Rule Registry: неизвестный статус ${status}.`
    );
  }
  if (!SUPPORTED_DECISIONS.has(approvedDecision)) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      `Owner Rule Registry: неизвестное решение ${approvedDecision}.`
    );
  }
  if (!validIsoDate(value.approvedAt)) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: approvedAt должен быть ISO-датой.'
    );
  }
  const notes = optionalString(value.notes);
  if (value.notes !== null && value.notes !== undefined && !notes) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: notes должен быть строкой или null.'
    );
  }
  const base = {
    ruleId: requiredString(value.ruleId, 'ruleId'),
    proposalId: requiredString(value.proposalId, 'proposalId'),
    stableItemKey: requiredString(value.stableItemKey, 'stableItemKey'),
    name: requiredString(value.name, 'name'),
    brand: optionalString(value.brand),
    ruleType: requiredString(value.ruleType, 'ruleType'),
    approvedDecision,
    approvedAt: value.approvedAt,
    status,
    createdFromVersion: requiredString(
      value.createdFromVersion,
      'createdFromVersion'
    ),
    notes,
  };
  return {
    ...base,
    ...optionalMaterializationFields({
      ...value,
      status,
      approvedDecision,
      stableItemKey: base.stableItemKey,
    }),
  };
}

function validateRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry должен быть объектом.'
    );
  }
  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry имеет неподдерживаемую версию схемы.'
    );
  }
  if (
    value.updatedAt !== null &&
    value.updatedAt !== undefined &&
    !validIsoDate(value.updatedAt)
  ) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: updatedAt должен быть ISO-датой или null.'
    );
  }
  if (!Array.isArray(value.rules)) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      'Owner Rule Registry: rules должен быть массивом.'
    );
  }
  const rules = value.rules.map(validateRule);
  const ruleIds = new Set();
  const proposalIds = new Set();
  for (const rule of rules) {
    if (ruleIds.has(rule.ruleId) || proposalIds.has(rule.proposalId)) {
      throw new OwnerRuleRegistryError(
        'RULE_REGISTRY_INVALID',
        'Owner Rule Registry содержит дублирующееся правило.'
      );
    }
    ruleIds.add(rule.ruleId);
    proposalIds.add(rule.proposalId);
  }
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: value.updatedAt || null,
    rules,
  };
}

function logRegistryError(error, options = {}) {
  const logger = options.logger || console;
  if (typeof logger.error === 'function') {
    logger.error(`[${error.code || 'RULE_REGISTRY_ERROR'}] ${error.message}`);
  }
}

function registryPaths(options = {}) {
  return {
    registryPath: path.resolve(
      options.registryPath || DEFAULT_REGISTRY_PATH
    ),
    markdownPath: path.resolve(
      options.markdownPath || DEFAULT_MARKDOWN_PATH
    ),
  };
}

function loadApprovedRules(options = {}) {
  const fsModule = options.fsModule || fs;
  const { registryPath } = registryPaths(options);
  try {
    const source = fsModule.readFileSync(registryPath, 'utf8');
    return validateRegistry(JSON.parse(source));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyApprovedRulesRegistry();
    const registryError = error instanceof OwnerRuleRegistryError
      ? error
      : new OwnerRuleRegistryError(
        'RULE_REGISTRY_CORRUPTED',
        'Реестр утверждённых правил повреждён и не был перезаписан.',
        { cause: error }
      );
    logRegistryError(registryError, options);
    throw registryError;
  }
}

function loadApprovedRulesTolerant(options = {}) {
  const fsModule = options.fsModule || fs;
  const { registryPath } = registryPaths(options);
  try {
    const source = JSON.parse(fsModule.readFileSync(registryPath, 'utf8'));
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return validateRegistry(source);
    }
    if (!Array.isArray(source.rules)) {
      return validateRegistry(source);
    }
    const envelope = validateRegistry({
      ...source,
      rules: [],
    });
    return {
      ...envelope,
      rules: source.rules.map(rule => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
          return rule;
        }
        try {
          return validateRule(rule);
        } catch {
          return null;
        }
      }),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyApprovedRulesRegistry();
    const registryError = error instanceof OwnerRuleRegistryError
      ? error
      : new OwnerRuleRegistryError(
        'RULE_REGISTRY_CORRUPTED',
        'Реестр утверждённых правил повреждён и не был перезаписан.',
        { cause: error }
      );
    logRegistryError(registryError, options);
    throw registryError;
  }
}

function registryFingerprint(registry) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(validateRegistry(registry)), 'utf8')
    .digest('hex');
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildApprovedRulesMarkdown(registry) {
  const validated = validateRegistry(registry);
  const activeCount = validated.rules.filter(
    rule => rule.status === 'ACTIVE'
  ).length;
  const disabledCount = validated.rules.length - activeCount;
  const lines = [
    '# Подтверждённые правила владельца',
    '',
    `- Количество правил: ${validated.rules.length}`,
    `- Активных: ${activeCount}`,
    `- Отключённых: ${disabledCount}`,
    '',
  ];
  if (validated.rules.length === 0) {
    lines.push('Пока нет подтверждённых правил.', '');
    return lines.join('\n');
  }
  lines.push(
    '| Название | Бренд | Решение | Статус | Дата подтверждения | proposalId |',
    '|---|---|---|---|---|---|'
  );
  for (const rule of validated.rules) {
    lines.push(
      `| ${markdownCell(rule.name)} | ${markdownCell(
        rule.brand || 'не указан'
      )} | ${DECISION_LABELS[rule.approvedDecision]} | ${
        STATUS_LABELS[rule.status]
      } | ${rule.approvedAt} | ${markdownCell(rule.proposalId)} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function fsyncDirectory(directoryPath, fsModule) {
  let descriptor;
  try {
    descriptor = fsModule.openSync(directoryPath, 'r');
    fsModule.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fsModule.closeSync(descriptor);
  }
}

function writeTemporaryFile(filePath, content, suffix, fsModule) {
  const directoryPath = path.dirname(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}-${suffix}.tmp`
  );
  let descriptor;
  try {
    fsModule.mkdirSync(directoryPath, { recursive: true });
    descriptor = fsModule.openSync(temporaryPath, 'wx', 0o600);
    fsModule.writeFileSync(descriptor, content, 'utf8');
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    return temporaryPath;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsModule.closeSync(descriptor);
      } catch {}
    }
    try {
      if (fsModule.existsSync(temporaryPath)) {
        fsModule.unlinkSync(temporaryPath);
      }
    } catch {}
    throw error;
  }
}

function writeLockOption(value, fallback, name, minimum) {
  const normalized = value === undefined ? fallback : value;
  if (
    !Number.isInteger(normalized) ||
    normalized < minimum ||
    normalized > 60_000
  ) {
    throw new OwnerRuleRegistryError(
      'RULE_REGISTRY_INVALID',
      `${name} имеет неверное значение.`
    );
  }
  return normalized;
}

function acquireRegistryWriteLock(paths, options, fsModule) {
  const lockPath = path.resolve(
    options.lockPath || `${paths.registryPath}.lock`
  );
  const timeoutMs = writeLockOption(
    options.lockTimeoutMs,
    DEFAULT_WRITE_LOCK_TIMEOUT_MS,
    'lockTimeoutMs',
    0
  );
  const staleMs = writeLockOption(
    options.lockStaleMs,
    DEFAULT_WRITE_LOCK_STALE_MS,
    'lockStaleMs',
    1
  );
  const retryMs = writeLockOption(
    options.lockRetryMs,
    DEFAULT_WRITE_LOCK_RETRY_MS,
    'lockRetryMs',
    1
  );
  const startedAt = Date.now();
  const lockId = crypto.randomBytes(16).toString('hex');
  fsModule.mkdirSync(path.dirname(lockPath), { recursive: true });
  while (true) {
    let descriptor;
    try {
      descriptor = fsModule.openSync(lockPath, 'wx', 0o600);
      fsModule.writeFileSync(
        descriptor,
        `${JSON.stringify({
          lockId,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })}\n`,
        'utf8'
      );
      fsModule.fsyncSync(descriptor);
      fsModule.closeSync(descriptor);
      descriptor = undefined;
      return { lockId, lockPath };
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fsModule.closeSync(descriptor);
        } catch {}
        try {
          fsModule.unlinkSync(lockPath);
        } catch {}
      }
      if (error.code !== 'EEXIST') throw error;
      try {
        const ageMs = Date.now() -
          fsModule.statSync(lockPath).mtimeMs;
        if (ageMs >= staleMs) {
          fsModule.unlinkSync(lockPath);
          continue;
        }
      } catch (inspectionError) {
        if (inspectionError.code === 'ENOENT') continue;
        throw inspectionError;
      }
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new OwnerRuleRegistryError(
          'RULE_REGISTRY_WRITE_LOCKED',
          'Реестр правил временно занят другим процессом.'
        );
      }
      const waitMs = Math.min(retryMs, timeoutMs - elapsedMs);
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        waitMs
      );
    }
  }
}

function releaseRegistryWriteLock(lock, fsModule) {
  try {
    const value = JSON.parse(fsModule.readFileSync(lock.lockPath, 'utf8'));
    if (value.lockId !== lock.lockId) {
      throw new OwnerRuleRegistryError(
        'RULE_REGISTRY_WRITE_LOCKED',
        'Registry write lock был заменён другим процессом.'
      );
    }
    fsModule.unlinkSync(lock.lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function saveApprovedRules(registry, options = {}) {
  const fsModule = options.fsModule || fs;
  const paths = registryPaths(options);
  const validated = validateRegistry(registry);
  const suffix = options.randomSuffix ||
    crypto.randomBytes(6).toString('hex');
  const publicationWarnings = [];
  let writeLock;
  try {
    writeLock = acquireRegistryWriteLock(paths, options, fsModule);
  } catch (error) {
    if (error instanceof OwnerRuleRegistryError) throw error;
    const lockError = new OwnerRuleRegistryError(
      'RULE_REGISTRY_WRITE_LOCKED',
      'Не удалось получить registry write lock.',
      { cause: error }
    );
    logRegistryError(lockError, options);
    throw lockError;
  }
  try {
    const registryExists = fsModule.existsSync(paths.registryPath);
    const current = registryExists
      ? loadApprovedRules({ ...options, fsModule })
      : emptyApprovedRulesRegistry();
    const currentFingerprint = registryFingerprint(current);
    if (options.expectedFingerprint !== undefined) {
      if (
        typeof options.expectedFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(options.expectedFingerprint)
      ) {
        throw new OwnerRuleRegistryError(
          'RULE_REGISTRY_INVALID',
          'Expected fingerprint реестра имеет неверный формат.'
        );
      }
      if (currentFingerprint !== options.expectedFingerprint) {
        throw new OwnerRuleRegistryError(
          'RULE_REGISTRY_CONCURRENT_MODIFICATION',
          'Реестр правил был изменён другим запросом.'
        );
      }
    } else if (
      registryExists &&
      registryFingerprint(validated) !== currentFingerprint
    ) {
      throw new OwnerRuleRegistryError(
        'RULE_REGISTRY_CONCURRENT_MODIFICATION',
        'Для изменения существующего реестра нужен expected fingerprint.'
      );
    }
    let registryTemporaryPath = null;
    try {
      registryTemporaryPath = writeTemporaryFile(
        paths.registryPath,
        `${JSON.stringify(validated, null, 2)}\n`,
        `${suffix}-json`,
        fsModule
      );
      fsModule.renameSync(registryTemporaryPath, paths.registryPath);
      registryTemporaryPath = null;
    } catch (error) {
      try {
        if (
          registryTemporaryPath &&
          fsModule.existsSync(registryTemporaryPath)
        ) {
          fsModule.unlinkSync(registryTemporaryPath);
        }
      } catch {}
      const registryError = new OwnerRuleRegistryError(
        'RULE_REGISTRY_WRITE_FAILED',
        'Не удалось атомарно сохранить реестр утверждённых правил.',
        { cause: error }
      );
      logRegistryError(registryError, options);
      throw registryError;
    }
    try {
      fsyncDirectory(path.dirname(paths.registryPath), fsModule);
    } catch {
      publicationWarnings.push(
        'RULE_REGISTRY_JSON_DIRECTORY_SYNC_FAILED'
      );
    }
  } finally {
    releaseRegistryWriteLock(writeLock, fsModule);
  }
  let markdownTemporaryPath = null;
  try {
    markdownTemporaryPath = writeTemporaryFile(
      paths.markdownPath,
      buildApprovedRulesMarkdown(validated),
      `${suffix}-md`,
      fsModule
    );
    fsModule.renameSync(markdownTemporaryPath, paths.markdownPath);
    markdownTemporaryPath = null;
    fsyncDirectory(path.dirname(paths.markdownPath), fsModule);
  } catch {
    try {
      if (
        markdownTemporaryPath &&
        fsModule.existsSync(markdownTemporaryPath)
      ) {
        fsModule.unlinkSync(markdownTemporaryPath);
      }
    } catch {}
    publicationWarnings.push(
      'RULE_REGISTRY_MARKDOWN_PUBLICATION_FAILED'
    );
  }
  if (publicationWarnings.length > 0) {
    Object.defineProperty(validated, 'publicationWarnings', {
      configurable: false,
      enumerable: false,
      value: Object.freeze([...publicationWarnings]),
      writable: false,
    });
    if (typeof options.logger?.warn === 'function') {
      try {
        for (const code of publicationWarnings) {
          options.logger.warn(
            `[${code}] Производный registry artifact не опубликован.`
          );
        }
      } catch {}
    }
  }
  return validated;
}

function ruleList(registryOrRules) {
  if (Array.isArray(registryOrRules)) return registryOrRules;
  return registryOrRules?.rules || [];
}

function findRuleByProposalId(registryOrRules, proposalId) {
  const normalized = optionalString(proposalId);
  if (!normalized) return null;
  return ruleList(registryOrRules).find(
    rule => rule.proposalId === normalized
  ) || null;
}

function findRuleByStableItemKey(registryOrRules, stableItemKey) {
  const normalized = optionalString(stableItemKey);
  if (!normalized) return null;
  return ruleList(registryOrRules).find(
    rule => rule.stableItemKey === normalized
  ) || null;
}

function findRuleByMaterialization(
  registryOrRules,
  { candidateId, materializationId } = {}
) {
  const normalizedCandidateId = optionalString(candidateId);
  const normalizedMaterializationId =
    optionalString(materializationId);
  return ruleList(registryOrRules).find(rule =>
    (
      normalizedCandidateId &&
      rule.provenance?.candidateId === normalizedCandidateId
    ) ||
    (
      normalizedMaterializationId &&
      rule.proposalId === normalizedMaterializationId
    )
  ) || null;
}

function validateProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new OwnerRuleRegistryError(
      'PROPOSAL_INVALID',
      'Предложение правила должно быть объектом.'
    );
  }
  const stableItemKey = requiredString(
    proposal.stableItemKey,
    'stableItemKey'
  );
  const proposedDecision = requiredString(
    proposal.proposedDecision,
    'proposedDecision'
  ).toUpperCase();
  const ruleType = requiredString(proposal.ruleType, 'ruleType');
  const proposalId = requiredString(proposal.proposalId, 'proposalId');
  if (
    ruleType !== RULE_TYPE ||
    !SUPPORTED_DECISIONS.has(proposedDecision) ||
    proposal.status !== 'PENDING' ||
    proposalId !== buildProposalId(
      stableItemKey,
      proposedDecision,
      ruleType
    )
  ) {
    throw new OwnerRuleRegistryError(
      'PROPOSAL_INVALID',
      'Предложение правила не соответствует контракту v0.3.'
    );
  }
  return {
    proposalId,
    stableItemKey,
    name: requiredString(proposal.name, 'name'),
    brand: optionalString(proposal.brand),
    ruleType,
    proposedDecision,
  };
}

function buildRuleId(proposalId) {
  const digest = crypto
    .createHash('sha256')
    .update(proposalId, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `approved-rule-${digest}`;
}

function inferredSku(proposal) {
  const explicit = optionalString(proposal?.sku);
  if (explicit) return explicit;
  const stableItemKey = optionalString(proposal?.stableItemKey);
  return stableItemKey?.startsWith('sku:')
    ? stableItemKey.slice('sku:'.length)
    : null;
}

function optionalNonNegativeNumber(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function skippedHistoryResult() {
  return {
    status: 'SKIPPED',
    decisionId: null,
    added: false,
    warning: {
      code: 'DECISION_HISTORY_DISABLED',
      message: 'Запись истории отключена для этой операции.',
    },
  };
}

function recordApprovedRuleHistory(proposal, rule, options = {}) {
  if (options.recordDecisionHistory === false) {
    return skippedHistoryResult();
  }
  const recorder = options.historyRecorder ||
    recordOwnerDecisionHistory;
  try {
    return recorder({
      historyFilePath:
        options.ownerDecisionHistoryPath || DEFAULT_HISTORY_PATH,
      source: 'APPROVED_RULE',
      runContext: {
        runId: proposal.runId ?? null,
        recordedAt: rule.approvedAt,
        applicationMode: proposal.applicationMode ?? null,
      },
      itemContext: {
        supplier: proposal.supplier ?? null,
        stableItemKey: rule.stableItemKey,
        sku: inferredSku(proposal),
        productName: rule.name,
        brand: rule.brand,
        category: proposal.category ?? null,
      },
      agentDecision: {
        recommendation:
          proposal.agentRecommendation ?? null,
        quantity: optionalNonNegativeNumber(
          proposal.agentQuantity
        ),
      },
      ownerDecision: {
        decision: rule.approvedDecision,
        quantity: rule.approvedDecision === 'SKIP' ? 0 : null,
        reasonCode:
          proposal.reasonCode ?? 'NOT_SPECIFIED',
        comment:
          proposal.ownerComment ?? rule.notes ?? null,
      },
      ruleContext: {
        ruleId: rule.ruleId,
      },
      financialContext: proposal.financialContext || {},
      inventoryContext: proposal.inventoryContext || {},
      salesContext: proposal.salesContext || {},
      metadata: {
        proposalId: rule.proposalId,
      },
      logger: options.logger,
    });
  } catch {
    if (typeof options.logger?.warn === 'function') {
      options.logger.warn(
        '[DECISION_HISTORY_UNAVAILABLE] ' +
        'Owner Decision History недоступен.'
      );
    }
    return {
      status: 'UNAVAILABLE',
      decisionId: null,
      added: false,
      warning: {
        code: 'DECISION_HISTORY_UNAVAILABLE',
        message: 'Историю решения временно не удалось сохранить.',
      },
    };
  }
}

function approveProposal(proposal, options = {}) {
  const validatedProposal = validateProposal(proposal);
  const registry = loadApprovedRules(options);
  const existing = findRuleByProposalId(
    registry,
    validatedProposal.proposalId
  );
  if (existing) {
    recordApprovedRuleHistory(proposal, existing, options);
    return existing;
  }
  const approvedAt = options.approvedAt ||
    new Date(options.currentDate || Date.now()).toISOString();
  if (!validIsoDate(approvedAt)) {
    throw new OwnerRuleRegistryError(
      'PROPOSAL_INVALID',
      'Дата подтверждения правила должна быть ISO-датой.'
    );
  }
  const rule = validateRule({
    ruleId: buildRuleId(validatedProposal.proposalId),
    proposalId: validatedProposal.proposalId,
    stableItemKey: validatedProposal.stableItemKey,
    name: validatedProposal.name,
    brand: validatedProposal.brand,
    ruleType: validatedProposal.ruleType,
    approvedDecision: validatedProposal.proposedDecision,
    approvedAt,
    status: 'ACTIVE',
    createdFromVersion: options.createdFromVersion || PROPOSALS_VERSION,
    notes: optionalString(options.notes),
  });
  saveApprovedRules({
    ...registry,
    updatedAt: approvedAt,
    rules: [...registry.rules, rule],
  }, {
    ...options,
    expectedFingerprint: registryFingerprint(registry),
  });
  recordApprovedRuleHistory(proposal, rule, options);
  return rule;
}

module.exports = {
  DEFAULT_MARKDOWN_PATH,
  DEFAULT_REGISTRY_PATH,
  REGISTRY_SCHEMA_VERSION,
  OwnerRuleRegistryError,
  approveProposal,
  buildApprovedRulesMarkdown,
  buildRuleId,
  emptyApprovedRulesRegistry,
  findRuleByProposalId,
  findRuleByStableItemKey,
  findRuleByMaterialization,
  loadApprovedRules,
  loadApprovedRulesTolerant,
  recordApprovedRuleHistory,
  registryFingerprint,
  saveApprovedRules,
  validateRegistry,
};
