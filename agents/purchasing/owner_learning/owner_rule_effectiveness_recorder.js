const crypto = require('node:crypto');

const {
  appendRuleEffectivenessEvent,
  createRuleEffectivenessEvent,
} = require('./owner_rule_effectiveness');

const RECORDER_VERSION = 'owner-rule-effectiveness-recorder-v0.9.3';
const WARNING_CODE = 'OWNER_RULE_EFFECTIVENESS_UNAVAILABLE';

function hash(value) {
  return crypto.createHash('sha256')
    .update(
      typeof value === 'string' ? value : JSON.stringify(value),
      'utf8'
    )
    .digest('hex');
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function materializedRule(rule) {
  return Boolean(
    rule &&
    typeof rule === 'object' &&
    rule.source === 'OWNER_LEARNING_CANDIDATE' &&
    rule.provenance?.source === 'OWNER_LEARNING_CANDIDATE' &&
    rule.scopeType === 'ITEM' &&
    rule.ruleType === 'ITEM_DECISION_OVERRIDE'
  );
}

function safeRuleFingerprint(rule) {
  return {
    ruleId: optionalText(rule.ruleId),
    candidateId: optionalText(rule.provenance?.candidateId),
    status: optionalText(rule.status),
    ruleType: optionalText(rule.ruleType),
    decision: optionalText(
      rule.action?.decision ?? rule.approvedDecision
    ),
    stableItemKeyHash: hash(optionalText(rule.stableItemKey) || ''),
    updatedAt: optionalText(rule.updatedAt),
  };
}

function registryFingerprint(registry) {
  const rules = Array.isArray(registry?.rules)
    ? registry.rules
      .filter(materializedRule)
      .map(safeRuleFingerprint)
      .sort((left, right) =>
        String(left.ruleId).localeCompare(String(right.ruleId))
      )
    : [];
  return hash({
    schemaVersion: registry?.schemaVersion || null,
    updatedAt: registry?.updatedAt || null,
    rules,
  });
}

function runFingerprint(runContext, applicationResult) {
  if (
    typeof runContext?.runFingerprint === 'string' &&
    /^[0-9a-f]{64}$/i.test(runContext.runFingerprint)
  ) {
    return runContext.runFingerprint.toLowerCase();
  }
  return hash({
    runId: runContext?.runId || null,
    recordedAt: runContext?.recordedAt || runContext?.generatedAt || null,
    supplier: runContext?.supplier || null,
    applicationMode:
      runContext?.applicationMode || applicationResult?.mode || null,
    applicationStatus: applicationResult?.status || null,
    amountBefore: applicationResult?.amountBefore ?? null,
    amountAfter: applicationResult?.amountAfter ?? null,
    applications: (applicationResult?.applications || []).map(
      application => ({
        ruleId: application?.ruleId || null,
        rowIdentity: application?.rowIdentity || null,
        applicationStatus: application?.applicationStatus || null,
        agentRecommendation:
          application?.agentRecommendation || null,
        finalRecommendation:
          application?.finalRecommendation || null,
        agentQuantity: application?.agentQuantity ?? null,
        finalQuantity: application?.finalQuantity ?? null,
        ruleApplied: application?.ruleApplied === true,
      })
    ),
  });
}

function warnOnce(logger) {
  if (typeof logger?.warn === 'function') {
    try {
      logger.warn(
        `[${WARNING_CODE}] ` +
        'Аналитику эффективности правил не удалось записать; ' +
        'результат закупки сохранён.'
      );
    } catch {}
  }
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function rounded(value) {
  const number = finite(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function applicationForRule(applications, ruleId) {
  return applications.find(application =>
    application?.ruleId === ruleId ||
    application?.diagnostics?.conflictRuleIds?.includes(ruleId)
  ) || null;
}

function productForApplication(financialContext, application) {
  if (!application) return null;
  const products = Array.isArray(financialContext?.workingOrderProducts)
    ? financialContext.workingOrderProducts
    : [];
  return products.find(product =>
    product?.rowIdentity === application.rowIdentity
  ) || null;
}

function effectFor(applicationResult, application) {
  if (applicationResult?.status === 'FALLBACK_TO_BASELINE') {
    return {
      evaluationStatus: 'EVALUATED',
      effectStatus: 'FALLBACK_TO_BASELINE',
    };
  }
  if (!application) {
    return {
      evaluationStatus: 'EVALUATED',
      effectStatus: 'NO_MATCH',
    };
  }
  if (
    application.ruleApplied === true &&
    application.applicationStatus === 'APPLIED' &&
    (
      application.agentRecommendation !== application.finalRecommendation ||
      application.agentQuantity !== application.finalQuantity
    )
  ) {
    return {
      evaluationStatus: 'EVALUATED',
      effectStatus: 'APPLIED_EFFECT',
    };
  }
  return {
    evaluationStatus: 'EVALUATED',
    effectStatus: 'MATCHED_NO_CHANGE',
  };
}

function impactFor({
  application,
  applicationResult,
  financialContext,
  effectStatus,
}) {
  const applied = effectStatus === 'APPLIED_EFFECT';
  const matched = Boolean(application);
  const quantityBefore = matched
    ? finite(application.agentQuantity)
    : 0;
  const quantityAfter = matched
    ? finite(application.finalQuantity)
    : 0;
  const quantityDelta = (
    quantityBefore === null || quantityAfter === null
  ) ? null : quantityAfter - quantityBefore;
  const product = productForApplication(financialContext, application);
  const unitPrice = finite(product?.priceNum ?? product?.unitPrice);
  const lineAmountBefore = (
    quantityBefore === null || unitPrice === null
  ) ? null : rounded(quantityBefore * unitPrice);
  const lineAmountAfter = (
    quantityAfter === null || unitPrice === null
  ) ? null : rounded(quantityAfter * unitPrice);
  const reportAmountBefore = finite(applicationResult?.amountBefore);
  const reportAmountAfter = finite(applicationResult?.amountAfter);
  const orderAmountBefore = matched
    ? lineAmountBefore
    : (reportAmountBefore === null ? 0 : reportAmountBefore);
  const orderAmountAfter = matched
    ? lineAmountAfter
    : orderAmountBefore;
  const orderAmountDelta = applied
    ? (
      lineAmountBefore === null || lineAmountAfter === null
        ? (
          reportAmountBefore === null || reportAmountAfter === null
            ? null
            : rounded(reportAmountAfter - reportAmountBefore)
        )
        : rounded(lineAmountAfter - lineAmountBefore)
    )
    : 0;
  return {
    affectedRows: applied ? 1 : 0,
    decisionChanges: applied &&
      application.agentRecommendation !==
        application.finalRecommendation
      ? 1
      : 0,
    quantityChanges: applied &&
      quantityBefore !== quantityAfter
      ? 1
      : 0,
    quantityBefore,
    quantityAfter,
    quantityDelta: applied ? quantityDelta : 0,
    orderAmountBefore,
    orderAmountAfter: applied ? (
      lineAmountAfter ?? reportAmountAfter
    ) : orderAmountAfter,
    orderAmountDelta,
    financialStatusBefore:
      optionalText(applicationResult?.financialStatusBefore) ||
      optionalText(financialContext?.financialStatusBefore),
    financialStatusAfter:
      optionalText(applicationResult?.financialStatusAfter) ||
      optionalText(financialContext?.financialStatusAfter),
    financiallyPermitted:
      typeof applicationResult
        ?.appliedWorkingOrderFinancialAssessment
        ?.financiallyPermitted === 'boolean'
        ? applicationResult
          .appliedWorkingOrderFinancialAssessment
          .financiallyPermitted
        : (
          typeof financialContext?.financiallyPermitted === 'boolean'
            ? financialContext.financiallyPermitted
            : null
        ),
  };
}

function inferredSecondary(rule) {
  const stableItemKey = optionalText(rule?.stableItemKey);
  if (stableItemKey?.startsWith('sku:')) {
    return `SKU ${stableItemKey.slice('sku:'.length)}`;
  }
  return optionalText(rule?.brand);
}

function result(status, recorded, duplicates, failed, warnings) {
  return {
    status,
    recorded,
    duplicates,
    failed,
    warnings,
  };
}

function recordRuleEffectivenessForRun(
  input = {},
  dependencyOverrides = {}
) {
  const applicationMode = optionalText(
    input.runContext?.applicationMode ??
    input.applicationResult?.mode
  )?.toUpperCase();
  if (applicationMode !== 'APPLY_SAFE') {
    return result('SKIPPED', 0, 0, 0, []);
  }
  const activeRules = Array.isArray(input.registry?.rules)
    ? input.registry.rules.filter(rule =>
      materializedRule(rule) && rule.status === 'ACTIVE'
    )
    : [];
  if (activeRules.length === 0) {
    return result('SKIPPED', 0, 0, 0, []);
  }
  const append = dependencyOverrides.append ||
    appendRuleEffectivenessEvent;
  const create = dependencyOverrides.create ||
    createRuleEffectivenessEvent;
  const applications = Array.isArray(
    input.applicationResult?.applications
  ) ? input.applicationResult.applications : [];
  const recordedAt = input.runContext?.recordedAt ||
    input.runContext?.generatedAt;
  const registryHash = registryFingerprint(input.registry);
  const runHash = runFingerprint(
    input.runContext,
    input.applicationResult
  );
  let recorded = 0;
  let duplicates = 0;
  let failed = 0;
  let warned = false;
  const warnings = [];

  for (const rule of activeRules) {
    try {
      const application = applicationForRule(
        applications,
        rule.ruleId
      );
      const effect = effectFor(
        input.applicationResult,
        application
      );
      const fallbackOccurred =
        effect.effectStatus === 'FALLBACK_TO_BASELINE';
      const event = create({
        recordedAt,
        runId: input.runContext?.runId,
        supplier: input.runContext?.supplier ?? null,
        ruleId: rule.ruleId,
        candidateId: rule.provenance?.candidateId ?? null,
        ruleStatus: rule.status,
        ruleType: rule.ruleType,
        decision:
          rule.action?.decision ?? rule.approvedDecision,
        evaluationStatus: effect.evaluationStatus,
        effectStatus: effect.effectStatus,
        scopeSnapshot: {
          displayPrimary: optionalText(rule.name),
          displaySecondary: inferredSecondary(rule),
          stableItemKeyHash: hash(rule.stableItemKey),
        },
        impact: impactFor({
          application,
          applicationResult: input.applicationResult,
          financialContext: input.financialContext,
          effectStatus: effect.effectStatus,
        }),
        fallback: {
          occurred: fallbackOccurred,
          reasonCode: fallbackOccurred
            ? optionalText(input.applicationResult?.errorCode) ||
              'APPLY_SAFE_FALLBACK'
            : null,
        },
        applicationMode,
        registryFingerprint: registryHash,
        runFingerprint: runHash,
        metadata: {
          recorderVersion: RECORDER_VERSION,
        },
      });
      const appended = append({
        filePath: input.effectivenessFilePath,
        event,
      });
      if (appended.added) recorded += 1;
      else duplicates += 1;
    } catch {
      failed += 1;
      if (!warned) {
        warned = true;
        warnings.push(WARNING_CODE);
        warnOnce(input.logger);
      }
    }
  }
  if (failed === activeRules.length) {
    return result('UNAVAILABLE', recorded, duplicates, failed, warnings);
  }
  if (failed > 0) {
    return result('PARTIAL', recorded, duplicates, failed, warnings);
  }
  return result('RECORDED', recorded, duplicates, failed, warnings);
}

module.exports = {
  RECORDER_VERSION,
  WARNING_CODE,
  materializedRule,
  recordRuleEffectivenessForRun,
  registryFingerprint,
  runFingerprint,
};
