const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadApprovedRules,
  validateRegistry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  processApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_application'
);
const {
  normalizeAgentRecommendation,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_report'
);
const {
  validateRuleStatusTransition,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_status_manager'
);
const {
  DEFAULT_RUNS_ROOT,
  isValidRunId,
} = require('../config');
const {
  PurchasingWebApplicationError,
} = require('./application_error');
const {
  PREVIEW_TTL_MS,
  saveActivationPreview,
} = require('./owner_rule_activation_preview_storage');

const MAX_CHANGED_ITEMS = 20;

function applicationError(code, message, cause) {
  throw new PurchasingWebApplicationError(code, message, { cause });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function registryFingerprint(registry) {
  return sha256(JSON.stringify(validateRegistry(registry)));
}

function safeText(value, maximum = 512) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    normalized.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function exactIsoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    applicationError(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Clock вернул недопустимую дату.'
    );
  }
  return date.toISOString();
}

function agentJson(agentResult) {
  const value = Array.isArray(agentResult)
    ? agentResult[0]?.json
    : null;
  if (!value || typeof value !== 'object') {
    applicationError(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Сохранённый purchasing result не поддерживает preview.'
    );
  }
  return value;
}

function finiteNonNegative(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0;
}

function lineSum(quantity, price) {
  if (!finiteNonNegative(quantity) || !finiteNonNegative(price)) {
    return null;
  }
  return Math.round(quantity * price * 100) / 100;
}

function restoreBaselineAgentResult(agentResult) {
  const result = structuredClone(agentResult);
  const json = agentJson(result);
  json.workingOrderProducts = (
    Array.isArray(json.workingOrderProducts)
      ? json.workingOrderProducts
      : []
  ).map(product => {
    const application = product.approvedRuleApplication;
    if (!application || typeof application !== 'object') return product;
    const restored = { ...product };
    delete restored.approvedRuleApplication;
    if (finiteNonNegative(application.agentQuantity)) {
      restored.approvedOrderQuantity = application.agentQuantity;
      restored.approvedLineSum = lineSum(
        application.agentQuantity,
        product.priceNum
      );
    }
    return restored;
  });
  json.decisions = (
    Array.isArray(json.decisions) ? json.decisions : []
  ).map(decision => {
    const application = decision.approvedRuleApplication;
    if (!application || typeof application !== 'object') return decision;
    const restored = { ...decision };
    delete restored.approvedRuleApplication;
    if (finiteNonNegative(application.agentQuantity)) {
      restored.approvedOrderQuantity = application.agentQuantity;
    }
    return restored;
  });
  return result;
}

function resultState(agentResult, applicationReport) {
  const json = agentJson(agentResult);
  const decisions = new Map(
    (Array.isArray(json.decisions) ? json.decisions : []).map(decision => [
      decision.rowIdentity,
      decision,
    ])
  );
  const applications = new Map(
    (Array.isArray(applicationReport?.applications)
      ? applicationReport.applications
      : []
    ).map(application => [application.rowIdentity, application])
  );
  const state = new Map();
  for (const product of (
    Array.isArray(json.workingOrderProducts)
      ? json.workingOrderProducts
      : []
  )) {
    const rowIdentity = safeText(product.rowIdentity, 1024);
    if (!rowIdentity) continue;
    const application = applications.get(rowIdentity);
    const decision = decisions.get(rowIdentity);
    state.set(rowIdentity, {
      rowIdentity,
      productName: safeText(product.name) || 'Товар без названия',
      sku: safeText(
        product.article || product.sku || product.barcode,
        256
      ),
      decision:
        application?.finalRecommendation ||
        normalizeAgentRecommendation(
          decision?.decision ||
          product.phase2Decision ||
          product.workflowStatus
        ) ||
        'UNKNOWN',
      quantity:
        application?.finalQuantity ??
        (
          finiteNonNegative(product.approvedOrderQuantity)
            ? product.approvedOrderQuantity
            : 0
        ),
      applicationStatus: application?.applicationStatus || 'UNCHANGED',
      ruleId: application?.ruleId || null,
    });
  }
  return state;
}

function changedItems(beforeState, afterState, ruleId) {
  const rows = new Set([...beforeState.keys(), ...afterState.keys()]);
  const changed = [];
  const affected = [];
  for (const rowIdentity of rows) {
    const before = beforeState.get(rowIdentity);
    const after = afterState.get(rowIdentity);
    if (!before || !after) continue;
    const decisionChanged = before.decision !== after.decision;
    const quantityChanged = before.quantity !== after.quantity;
    const selectedRuleAffected = (
      before.ruleId === ruleId ||
      after.ruleId === ruleId
    );
    if (selectedRuleAffected) affected.push(rowIdentity);
    if (decisionChanged || quantityChanged || selectedRuleAffected) {
      changed.push({
        productName: after.productName || before.productName,
        sku: after.sku || before.sku,
        decisionBefore: before.decision,
        decisionAfter: after.decision,
        quantityBefore: before.quantity,
        quantityAfter: after.quantity,
        decisionChanged,
        quantityChanged,
        selectedRuleAffected,
      });
    }
  }
  changed.sort((left, right) =>
    String(left.sku || left.productName).localeCompare(
      String(right.sku || right.productName),
      'en'
    )
  );
  return {
    affectedRows: new Set(affected).size,
    affectedItems: new Set(
      changed
        .filter(item => item.selectedRuleAffected)
        .map(item => item.sku || item.productName)
    ).size,
    decisionChanges: changed.filter(item => item.decisionChanged).length,
    quantityChanges: changed.filter(item => item.quantityChanged).length,
    changedItems: changed.slice(0, MAX_CHANGED_ITEMS).map(item => ({
      productName: item.productName,
      sku: item.sku,
      decisionBefore: item.decisionBefore,
      decisionAfter: item.decisionAfter,
      quantityBefore: item.quantityBefore,
      quantityAfter: item.quantityAfter,
    })),
  };
}

function delta(after, before) {
  return (
    typeof after === 'number' &&
    Number.isFinite(after) &&
    typeof before === 'number' &&
    Number.isFinite(before)
  ) ? Math.round((after - before) * 100) / 100 : null;
}

function scenario(agentResult, registry, generatedAt, processor) {
  const processed = processor({
    agentResult: structuredClone(agentResult),
    approvedRuleMode: 'APPLY_SAFE',
    approvedRules: structuredClone(registry),
    generatedAt,
  });
  const report = processed.approvedRuleApplications;
  if (
    !report ||
    report.status !== 'APPLIED' ||
    report.errorCode
  ) {
    applicationError(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Не удалось выполнить безопасный проверочный расчёт.'
    );
  }
  return {
    agentResult: processed.agentResult,
    report,
    warnings: Array.isArray(processed.warnings)
      ? processed.warnings
      : [],
  };
}

function warningCodes(before, after) {
  const codes = new Set();
  for (const warning of [...before.warnings, ...after.warnings]) {
    const code = safeText(warning?.code || warning, 128);
    if (code) codes.add(code);
  }
  if (after.report.blockedConflicts > 0) {
    codes.add('CONFLICTING_ACTIVE_RULES');
  }
  if (after.report.blockedInvalid > 0) {
    codes.add('BLOCKED_INVALID_RULE');
  }
  return [...codes].sort();
}

function criticalWarnings(codes) {
  return codes.filter(code => [
    'CONFLICTING_ACTIVE_RULES',
    'BLOCKED_INVALID_RULE',
    'APPROVED_RULE_APPLICATION_UNAVAILABLE',
    'APPROVED_RULE_PREVIEW_UNAVAILABLE',
  ].includes(code));
}

function previewSnapshot(preview) {
  return {
    previewId: preview.previewId,
    previewedAt: preview.previewedAt,
    ruleId: preview.rule.ruleId,
    currentRuleStatus: preview.rule.currentStatus,
    targetRuleStatus: preview.rule.targetStatus,
    ...structuredClone(preview.impact),
    warnings: structuredClone(preview.warnings),
  };
}

class OwnerRuleActivationPreviewService {
  constructor(options = {}) {
    for (const name of [
      'approvedRulesFilePath',
      'previewStorageFilePath',
    ]) {
      if (!options[name]) throw new TypeError(`${name} обязателен.`);
    }
    this.approvedRulesFilePath = path.resolve(
      options.approvedRulesFilePath
    );
    this.previewStorageFilePath = path.resolve(
      options.previewStorageFilePath
    );
    this.runsRoot = path.resolve(options.runsRoot || DEFAULT_RUNS_ROOT);
    this.fs = options.fsModule || fs;
    this.now = options.now || (() => new Date());
    this.previewTtlMs = options.previewTtlMs || PREVIEW_TTL_MS;
    this.loadRegistry = options.loadRegistry || loadApprovedRules;
    this.processRules = options.processRules || processApprovedRules;
    this.savePreview = options.savePreview || saveActivationPreview;
  }

  loadCurrentRegistry() {
    try {
      return this.loadRegistry({
        registryPath: this.approvedRulesFilePath,
        fsModule: this.fs,
        logger: { error() {} },
      });
    } catch (error) {
      applicationError(
        'RULE_REGISTRY_UNAVAILABLE',
        'Реестр правил временно недоступен.',
        error
      );
    }
  }

  readRun(runId) {
    if (!isValidRunId(runId)) {
      applicationError(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        'runId должен быть корректным UUID.'
      );
    }
    const filePath = path.join(
      this.runsRoot,
      runId,
      'artifacts',
      'result.json'
    );
    let source;
    try {
      source = this.fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      applicationError(
        error.code === 'ENOENT'
          ? 'RUN_NOT_FOUND'
          : 'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
        error.code === 'ENOENT'
          ? 'Purchasing run не найден.'
          : 'Purchasing result временно недоступен.',
        error
      );
    }
    try {
      const parsed = JSON.parse(source);
      agentJson(parsed);
      return {
        source,
        result: parsed,
        fingerprint: sha256(source),
      };
    } catch (error) {
      applicationError(
        'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
        'Purchasing result повреждён.',
        error
      );
    }
  }

  getRunFingerprint(runId) {
    return this.readRun(runId).fingerprint;
  }

  previewRuleStatusChange({ ruleId, targetStatus, runId } = {}) {
    const registry = this.loadCurrentRegistry();
    const normalizedRuleId = safeText(ruleId, 128);
    const rule = registry.rules.find(
      item => item.ruleId === normalizedRuleId
    );
    if (!rule) {
      applicationError(
        'OWNER_MATERIALIZED_RULE_NOT_FOUND',
        'Материализованное правило не найдено.'
      );
    }
    try {
      validateRuleStatusTransition({ rule, targetStatus });
    } catch (error) {
      const materialized = (
        rule?.provenance?.source === 'OWNER_LEARNING_CANDIDATE' &&
        rule?.ruleType === 'ITEM_DECISION_OVERRIDE'
      );
      applicationError(
        materialized
          ? 'OWNER_RULE_STATUS_TRANSITION_INVALID'
          : 'RULE_NOT_MATERIALIZED',
        materialized
          ? error.message
          : 'Правило не поддерживает ручное управление статусом.',
        error
      );
    }
    const target = targetStatus.trim().toUpperCase();
    const run = this.readRun(runId);
    const baseline = restoreBaselineAgentResult(run.result);
    const previewedAt = exactIsoNow(this.now);
    const expiresAt = new Date(
      Date.parse(previewedAt) + this.previewTtlMs
    ).toISOString();
    const targetRegistry = structuredClone(registry);
    const targetRule = targetRegistry.rules.find(
      item => item.ruleId === rule.ruleId
    );
    targetRule.status = target;
    const before = scenario(
      baseline,
      registry,
      previewedAt,
      this.processRules
    );
    const after = scenario(
      baseline,
      targetRegistry,
      previewedAt,
      this.processRules
    );
    const differences = changedItems(
      resultState(before.agentResult, before.report),
      resultState(after.agentResult, after.report),
      rule.ruleId
    );
    const warnings = warningCodes(before, after);
    const impact = {
      affectedItems: differences.affectedItems,
      affectedRows: differences.affectedRows,
      decisionChanges: differences.decisionChanges,
      quantityChanges: differences.quantityChanges,
      orderAmountBefore: before.report.amountAfter,
      orderAmountAfter: after.report.amountAfter,
      orderAmountDelta: delta(
        after.report.amountAfter,
        before.report.amountAfter
      ),
      unitsBefore: before.report.unitsAfter,
      unitsAfter: after.report.unitsAfter,
      unitsDelta: delta(
        after.report.unitsAfter,
        before.report.unitsAfter
      ),
      financialStatusBefore: before.report.financialStatusAfter,
      financialStatusAfter: after.report.financialStatusAfter,
      financiallyPermitted:
        after.report.appliedWorkingOrderFinancialAssessment
          ?.financiallyPermitted === true,
    };
    const currentFingerprint = registryFingerprint(registry);
    const previewId = sha256(JSON.stringify([
      rule.ruleId,
      target,
      runId,
      currentFingerprint,
      run.fingerprint,
      previewedAt,
      expiresAt,
    ]));
    const preview = {
      status: 'AVAILABLE',
      previewId,
      previewedAt,
      expiresAt,
      rule: {
        ruleId: rule.ruleId,
        currentStatus: rule.status,
        targetStatus: target,
        decision: rule.action.decision,
        displayScope: {
          primary: safeText(rule.name) || 'Товар без названия',
          secondary: (
            rule.stableItemKey.startsWith('sku:')
              ? safeText(rule.stableItemKey.slice(4), 256)
              : null
          ) || '—',
        },
      },
      impact,
      changedItems: differences.changedItems,
      warnings,
    };
    const critical = criticalWarnings(warnings);
    try {
      this.savePreview({
        filePath: this.previewStorageFilePath,
        preview: {
          previewId,
          createdAt: previewedAt,
          expiresAt,
          ruleId: rule.ruleId,
          targetStatus: target,
          runId,
          registryFingerprint: currentFingerprint,
          runFingerprint: run.fingerprint,
          financiallyPermitted: impact.financiallyPermitted,
          criticalWarnings: critical,
          impactSnapshot: {
            ...previewSnapshot(preview),
            rule: structuredClone(preview.rule),
            changedItems: structuredClone(preview.changedItems),
          },
        },
        now: this.now,
        fsModule: this.fs,
      });
    } catch (error) {
      applicationError(
        'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
        'Не удалось безопасно сохранить preview.',
        error
      );
    }
    return preview;
  }
}

function previewRuleStatusChange(input, options = {}) {
  return new OwnerRuleActivationPreviewService(options)
    .previewRuleStatusChange(input);
}

module.exports = {
  MAX_CHANGED_ITEMS,
  OwnerRuleActivationPreviewService,
  changedItems,
  previewRuleStatusChange,
  previewSnapshot,
  registryFingerprint,
  restoreBaselineAgentResult,
};
