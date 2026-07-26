const path = require('node:path');

const {
  loadApprovedRules,
  saveApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  appendRuleStatusEvent,
  createRuleStatusEvent,
  getCurrentRuleStatusHistory,
  loadRuleStatusEvents,
  validateRuleStatusTransition,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_status_manager'
);
const {
  PurchasingWebApplicationError,
} = require('./application_error');
const {
  getActivationPreview,
} = require('./owner_rule_activation_preview_storage');
const {
  registryFingerprint,
} = require('./owner_rule_activation_preview_service');

function error(code, message, cause) {
  throw new PurchasingWebApplicationError(code, message, { cause });
}

function normalizedText(value, name, maximum = 512) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    error(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      `${name} имеет неверное значение.`
    );
  }
  return value.trim();
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    error(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Clock вернул недопустимую дату.'
    );
  }
  return date.toISOString();
}

function oppositeStatus(status) {
  return status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
}

function publicRuleResult(rule, previousStatus) {
  return {
    ruleId: rule.ruleId,
    previousStatus,
    currentStatus: rule.status,
    updatedAt: rule.updatedAt,
  };
}

class OwnerRuleStatusService {
  constructor(options = {}) {
    for (const name of [
      'approvedRulesFilePath',
      'statusEventsFilePath',
      'previewStorageFilePath',
      'previewService',
    ]) {
      if (!options[name]) throw new TypeError(`${name} обязателен.`);
    }
    this.approvedRulesFilePath = path.resolve(
      options.approvedRulesFilePath
    );
    this.approvedRulesMarkdownPath = path.resolve(
      options.approvedRulesMarkdownPath ||
      this.approvedRulesFilePath.replace(/\.json$/i, '.md')
    );
    this.statusEventsFilePath = path.resolve(
      options.statusEventsFilePath
    );
    this.previewStorageFilePath = path.resolve(
      options.previewStorageFilePath
    );
    this.previewService = options.previewService;
    this.fs = options.fsModule;
    this.now = options.now || (() => new Date());
    this.loadRegistry = options.loadRegistry || loadApprovedRules;
    this.saveRegistry = options.saveRegistry || saveApprovedRules;
    this.loadEvents = options.loadEvents || loadRuleStatusEvents;
    this.appendEvent = options.appendEvent || appendRuleStatusEvent;
    this.getPreview = options.getPreview || getActivationPreview;
  }

  previewStatusChange(input) {
    return this.previewService.previewRuleStatusChange(input);
  }

  currentRegistry() {
    try {
      return this.loadRegistry({
        registryPath: this.approvedRulesFilePath,
        ...(this.fs ? { fsModule: this.fs } : {}),
        logger: { error() {} },
      });
    } catch (cause) {
      error(
        'RULE_REGISTRY_UNAVAILABLE',
        'Реестр правил временно недоступен.',
        cause
      );
    }
  }

  currentPreview(previewId) {
    try {
      return this.getPreview({
        filePath: this.previewStorageFilePath,
        previewId,
        now: this.now,
        ...(this.fs ? { fsModule: this.fs } : {}),
      });
    } catch (cause) {
      const code = [
        'PREVIEW_REQUIRED',
        'PREVIEW_EXPIRED',
      ].includes(cause?.code)
        ? cause.code
        : 'RULE_ACTIVATION_PREVIEW_UNAVAILABLE';
      error(
        code,
        code === 'PREVIEW_EXPIRED'
          ? 'Preview истёк.'
          : code === 'PREVIEW_REQUIRED'
            ? 'Актуальный preview обязателен.'
            : 'Preview storage временно недоступно.',
        cause
      );
    }
  }

  validatePreview(preview, {
    ruleId,
    targetStatus,
    registry,
    allowChangedRegistry = false,
  }) {
    if (preview.ruleId !== ruleId) {
      error('PREVIEW_TARGET_MISMATCH', 'Preview относится к другому правилу.');
    }
    if (preview.targetStatus !== targetStatus) {
      error(
        'PREVIEW_TARGET_MISMATCH',
        'Preview относится к другому целевому статусу.'
      );
    }
    if (
      !allowChangedRegistry &&
      preview.registryFingerprint !== registryFingerprint(registry)
    ) {
      error('PREVIEW_STALE', 'Реестр правил изменился после preview.');
    }
    let runFingerprint;
    try {
      runFingerprint = this.previewService.getRunFingerprint(preview.runId);
    } catch (cause) {
      if (cause?.code === 'RUN_NOT_FOUND') {
        error('PREVIEW_STALE', 'Данные run изменились после preview.', cause);
      }
      throw cause;
    }
    if (runFingerprint !== preview.runFingerprint) {
      error('PREVIEW_STALE', 'Данные run изменились после preview.');
    }
    if (preview.financiallyPermitted !== true) {
      error(
        'RULE_ACTIVATION_NOT_FINANCIALLY_PERMITTED',
        'Проверочный расчёт не разрешает изменение правила.'
      );
    }
    if (preview.criticalWarnings.length > 0) {
      error(
        'PREVIEW_STALE',
        'Preview содержит критические предупреждения.'
      );
    }
  }

  statusEvent({
    rule,
    targetStatus,
    preview,
    recordedAt,
    reasonCode,
    ownerComment,
    repair = false,
  }) {
    try {
      return createRuleStatusEvent({
        rule,
        targetStatus,
        recordedAt,
        confirmation: true,
        reasonCode,
        ownerComment,
        previewSnapshot: preview.impactSnapshot,
        metadata: {
          transitionSource: 'OWNER_RULE_STATUS_API',
          ...(repair ? { repair: true } : {}),
        },
      });
    } catch (cause) {
      error(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        cause.message,
        cause
      );
    }
  }

  appendStatusEvent(event) {
    try {
      return this.appendEvent({
        filePath: this.statusEventsFilePath,
        event,
        ...(this.fs ? { fsModule: this.fs } : {}),
      });
    } catch (cause) {
      error(
        'RULE_STATUS_STORAGE_UNAVAILABLE',
        'Статус изменён, но audit event временно не записан.',
        cause
      );
    }
  }

  repairAlreadyChanged({
    rule,
    targetStatus,
    preview,
    reasonCode,
    ownerComment,
  }) {
    this.validatePreview(preview, {
      ruleId: rule.ruleId,
      targetStatus,
      registry: null,
      allowChangedRegistry: true,
    });
    let events;
    try {
      events = this.loadEvents({
        filePath: this.statusEventsFilePath,
        ...(this.fs ? { fsModule: this.fs } : {}),
      }).events;
    } catch (cause) {
      error(
        'RULE_STATUS_STORAGE_UNAVAILABLE',
        'Журнал статусов правил временно недоступен.',
        cause
      );
    }
    const existing = events.find(event =>
      event.ruleId === rule.ruleId &&
      event.previewId === preview.previewId &&
      event.toStatus === targetStatus
    );
    if (existing) {
      return { repaired: false, event: existing };
    }
    const previousRule = {
      ...structuredClone(rule),
      status: oppositeStatus(targetStatus),
    };
    const event = this.statusEvent({
      rule: previousRule,
      targetStatus,
      preview,
      recordedAt: rule.updatedAt,
      reasonCode,
      ownerComment,
      repair: true,
    });
    this.appendStatusEvent(event);
    return { repaired: true, event };
  }

  changeStatus({
    ruleId,
    targetStatus,
    previewId,
    confirmation,
    reasonCode,
    ownerComment,
  } = {}) {
    if (confirmation !== true) {
      error(
        'OWNER_RULE_STATUS_CONFIRMATION_REQUIRED',
        'Необходимо явно подтвердить изменение статуса правила.'
      );
    }
    const normalizedRuleId = normalizedText(ruleId, 'ruleId', 128);
    const target = normalizedText(
      targetStatus,
      'targetStatus',
      32
    ).toUpperCase();
    const normalizedPreviewId = normalizedText(
      previewId,
      'previewId',
      128
    );
    const normalizedReason = (
      reasonCode === undefined || reasonCode === null || reasonCode === ''
    ) ? (
        target === 'ACTIVE' ? 'READY_TO_APPLY' : null
      ) : normalizedText(reasonCode, 'reasonCode', 64).toUpperCase();
    if (
      !normalizedReason ||
      (
        target === 'DISABLED' &&
        normalizedReason === 'NOT_SPECIFIED'
      )
    ) {
      error(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        'Для отключения правила необходимо выбрать причину.'
      );
    }
    const registry = this.currentRegistry();
    const index = registry.rules.findIndex(
      item => item.ruleId === normalizedRuleId
    );
    if (index < 0) {
      error(
        'OWNER_MATERIALIZED_RULE_NOT_FOUND',
        'Материализованное правило не найдено.'
      );
    }
    const rule = registry.rules[index];
    const preview = this.currentPreview(normalizedPreviewId);
    if (rule.status === target) {
      const repair = this.repairAlreadyChanged({
        rule,
        targetStatus: target,
        preview,
        reasonCode: normalizedReason,
        ownerComment,
      });
      return {
        status: 'ALREADY_CHANGED',
        rule: publicRuleResult(rule, oppositeStatus(target)),
        repair,
      };
    }
    try {
      validateRuleStatusTransition({ rule, targetStatus: target });
    } catch (cause) {
      const materialized = (
        rule.provenance?.source === 'OWNER_LEARNING_CANDIDATE' &&
        rule.ruleType === 'ITEM_DECISION_OVERRIDE'
      );
      error(
        materialized
          ? 'OWNER_RULE_STATUS_TRANSITION_INVALID'
          : 'RULE_NOT_MATERIALIZED',
        materialized
          ? cause.message
          : 'Правило не поддерживает ручное управление статусом.',
        cause
      );
    }
    this.validatePreview(preview, {
      ruleId: normalizedRuleId,
      targetStatus: target,
      registry,
    });
    const recordedAt = isoNow(this.now);
    const nextRegistry = structuredClone(registry);
    nextRegistry.rules[index] = {
      ...nextRegistry.rules[index],
      status: target,
      updatedAt: recordedAt,
    };
    nextRegistry.updatedAt = recordedAt;
    const event = this.statusEvent({
      rule,
      targetStatus: target,
      preview,
      recordedAt,
      reasonCode: normalizedReason,
      ownerComment,
    });
    try {
      this.saveRegistry(nextRegistry, {
        registryPath: this.approvedRulesFilePath,
        markdownPath: this.approvedRulesMarkdownPath,
        ...(this.fs ? { fsModule: this.fs } : {}),
        logger: { error() {} },
      });
    } catch (cause) {
      error(
        'RULE_REGISTRY_UNAVAILABLE',
        'Не удалось атомарно изменить статус правила.',
        cause
      );
    }
    this.appendStatusEvent(event);
    return {
      status: 'CHANGED',
      rule: publicRuleResult(
        nextRegistry.rules[index],
        rule.status
      ),
      repair: { repaired: false, event },
    };
  }

  getRuleStatusHistory({ ruleId } = {}) {
    const normalizedRuleId = normalizedText(ruleId, 'ruleId', 128);
    const registry = this.currentRegistry();
    if (!registry.rules.some(rule => rule.ruleId === normalizedRuleId)) {
      error(
        'OWNER_MATERIALIZED_RULE_NOT_FOUND',
        'Материализованное правило не найдено.'
      );
    }
    try {
      const journal = this.loadEvents({
        filePath: this.statusEventsFilePath,
        ...(this.fs ? { fsModule: this.fs } : {}),
      });
      return {
        ruleId: normalizedRuleId,
        events: getCurrentRuleStatusHistory({
          events: journal.events,
          ruleId: normalizedRuleId,
        }),
      };
    } catch (cause) {
      error(
        'RULE_STATUS_STORAGE_UNAVAILABLE',
        'Журнал статусов правил временно недоступен.',
        cause
      );
    }
  }
}

module.exports = {
  OwnerRuleStatusService,
  publicRuleResult,
};
