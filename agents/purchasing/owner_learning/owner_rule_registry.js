const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  REPORT_VERSION: PROPOSALS_VERSION,
  buildProposalId,
} = require('./owner_rule_proposals');

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
  return {
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

function saveApprovedRules(registry, options = {}) {
  const fsModule = options.fsModule || fs;
  const paths = registryPaths(options);
  const validated = validateRegistry(registry);
  if (fsModule.existsSync(paths.registryPath)) {
    loadApprovedRules({ ...options, fsModule });
  }
  const suffix = options.randomSuffix ||
    crypto.randomBytes(6).toString('hex');
  const contents = [
    {
      finalPath: paths.registryPath,
      content: `${JSON.stringify(validated, null, 2)}\n`,
      suffix: `${suffix}-json`,
    },
    {
      finalPath: paths.markdownPath,
      content: buildApprovedRulesMarkdown(validated),
      suffix: `${suffix}-md`,
    },
  ];
  const temporaryFiles = [];
  try {
    for (const file of contents) {
      temporaryFiles.push({
        ...file,
        temporaryPath: writeTemporaryFile(
          file.finalPath,
          file.content,
          file.suffix,
          fsModule
        ),
      });
    }
    for (const file of temporaryFiles) {
      fsModule.renameSync(file.temporaryPath, file.finalPath);
    }
    for (const directoryPath of new Set(
      temporaryFiles.map(file => path.dirname(file.finalPath))
    )) {
      fsyncDirectory(directoryPath, fsModule);
    }
    return validated;
  } catch (error) {
    for (const file of temporaryFiles) {
      try {
        if (fsModule.existsSync(file.temporaryPath)) {
          fsModule.unlinkSync(file.temporaryPath);
        }
      } catch {}
    }
    const registryError = new OwnerRuleRegistryError(
      'RULE_REGISTRY_WRITE_FAILED',
      'Не удалось атомарно сохранить реестр утверждённых правил.',
      { cause: error }
    );
    logRegistryError(registryError, options);
    throw registryError;
  }
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

function approveProposal(proposal, options = {}) {
  const validatedProposal = validateProposal(proposal);
  const registry = loadApprovedRules(options);
  const existing = findRuleByProposalId(
    registry,
    validatedProposal.proposalId
  );
  if (existing) return existing;
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
  }, options);
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
  loadApprovedRules,
  saveApprovedRules,
  validateRegistry,
};
