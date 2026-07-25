const {
  appendMaterializationEvent,
  findMaterializationByCandidate,
  loadMaterializationJournal,
  summarizeMaterializations,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);
const {
  MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materialization_journal'
);
const {
  materializeRuleFromCandidate,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_materializer'
);
const {
  findRuleByMaterialization,
  loadApprovedRules,
  saveApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);

class OwnerRuleMaterializationServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleMaterializationServiceError';
    this.code = code;
  }
}

function serviceError(code, message, cause) {
  return new OwnerRuleMaterializationServiceError(
    code,
    message,
    cause ? { cause } : {}
  );
}

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw serviceError(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'now должен возвращать допустимую дату.'
    );
  }
  return date.toISOString();
}

function journalEvent(materialization, rule, resultStatus, recordedAt) {
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    materializationId: materialization.materializationId,
    recordedAt,
    candidateId: materialization.candidateId,
    lifecycleEventId: materialization.provenance.lifecycleEventId,
    ruleId: rule.ruleId,
    resultStatus,
    ruleStatus: rule.status,
    fingerprint: materialization.fingerprint,
    snapshot: {
      patternType: materialization.provenance.patternType,
      proposedRuleType: rule.ruleType,
      proposedDecision: rule.approvedDecision,
      confidenceScore: materialization.provenance.confidenceScore,
      confidenceLevel: materialization.provenance.confidenceLevel,
      priorityScore: materialization.provenance.priorityScore,
      priorityLevel: materialization.provenance.priorityLevel,
    },
    metadata: { source: 'PURCHASING_WEB' },
  };
}

class OwnerRuleMaterializationService {
  constructor(options = {}) {
    for (const [name, value] of [
      ['candidatesService', options.candidatesService],
      ['lifecycleService', options.lifecycleService],
      ['materializationsFilePath', options.materializationsFilePath],
      ['registryPath', options.registryPath],
    ]) {
      if (!value) throw new TypeError(`${name} обязателен.`);
    }
    this.candidatesService = options.candidatesService;
    this.lifecycleService = options.lifecycleService;
    this.materializationsFilePath = options.materializationsFilePath;
    this.registryPath = options.registryPath;
    this.registryMarkdownPath = options.registryMarkdownPath ||
      String(options.registryPath).replace(/\.json$/i, '.md');
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.loadJournal =
      options.loadJournal || loadMaterializationJournal;
    this.appendEvent =
      options.appendEvent || appendMaterializationEvent;
    this.loadRegistry = options.loadRegistry || loadApprovedRules;
    this.saveRegistry = options.saveRegistry || saveApprovedRules;
    this.materialize =
      options.materialize || materializeRuleFromCandidate;
  }

  registryOptions() {
    return {
      registryPath: this.registryPath,
      markdownPath: this.registryMarkdownPath,
      logger: { error() {} },
    };
  }

  readJournal() {
    try {
      return this.loadJournal({
        filePath: this.materializationsFilePath,
      });
    } catch (error) {
      throw serviceError(
        'RULE_MATERIALIZATION_STORAGE_UNAVAILABLE',
        'Materialization journal временно недоступен.',
        error
      );
    }
  }

  readRegistry() {
    try {
      return this.loadRegistry(this.registryOptions());
    } catch (error) {
      throw serviceError(
        'RULE_REGISTRY_UNAVAILABLE',
        'Approved Rule Registry временно недоступен.',
        error
      );
    }
  }

  currentCandidate(candidateId) {
    const result = this.candidatesService.getCandidates();
    if (result.status !== 'AVAILABLE') {
      throw serviceError(
        'CANDIDATE_NOT_AVAILABLE',
        'Кандидат больше не доступен в текущей истории.'
      );
    }
    const candidate = result.candidates.find(
      value => value.candidateId === candidateId
    );
    if (!candidate) {
      throw serviceError(
        'CANDIDATE_NOT_AVAILABLE',
        'Кандидат больше не доступен в текущей истории.'
      );
    }
    return candidate;
  }

  currentLifecycle(candidateId) {
    return this.lifecycleService.getCandidateState({ candidateId });
  }

  appendOperation(materialization, rule, resultStatus, recordedAt) {
    try {
      return this.appendEvent({
        filePath: this.materializationsFilePath,
        event: journalEvent(
          materialization,
          rule,
          resultStatus,
          recordedAt
        ),
      });
    } catch (error) {
      throw serviceError(
        'RULE_MATERIALIZATION_STORAGE_UNAVAILABLE',
        'Правило сохранено, но журнал операции временно недоступен.',
        error
      );
    }
  }

  materializeCandidateRule({ candidateId } = {}) {
    const candidate = this.currentCandidate(candidateId);
    const lifecycleState = this.currentLifecycle(candidateId);
    const materializedAt = nowIso(this.now);
    const materialization = this.materialize({
      candidate,
      lifecycleState,
      options: { materializedAt },
    });
    const journal = this.readJournal();
    const recorded = findMaterializationByCandidate(
      journal,
      candidateId
    );
    const registry = this.readRegistry();
    const existingRule = findRuleByMaterialization(registry, {
      candidateId,
      materializationId: materialization.materializationId,
    });

    if (recorded) {
      const rule = existingRule || registry.rules.find(
        value => value.ruleId === recorded.ruleId
      );
      if (!rule) {
        throw serviceError(
          'RULE_REGISTRY_UNAVAILABLE',
          'Materialization journal не соответствует registry.'
        );
      }
      return {
        status: 'ALREADY_MATERIALIZED',
        candidate,
        rule,
        event: recorded,
      };
    }

    if (existingRule) {
      const repaired = this.appendOperation(
        materialization,
        existingRule,
        'ALREADY_MATERIALIZED',
        materializedAt
      );
      return {
        status: 'ALREADY_MATERIALIZED',
        candidate,
        rule: existingRule,
        event: repaired.event,
      };
    }

    let saved;
    try {
      saved = this.saveRegistry({
        ...registry,
        updatedAt: materializedAt,
        rules: [...registry.rules, materialization.ruleDraft],
      }, this.registryOptions());
    } catch (error) {
      throw serviceError(
        'RULE_REGISTRY_UNAVAILABLE',
        'Не удалось сохранить неактивное правило.',
        error
      );
    }
    const rule = findRuleByMaterialization(saved, {
      candidateId,
      materializationId: materialization.materializationId,
    });
    const appended = this.appendOperation(
      materialization,
      rule,
      'CREATED',
      materializedAt
    );
    return {
      status: 'CREATED',
      candidate,
      rule,
      event: appended.event,
    };
  }

  getMaterializationByCandidate({ candidateId } = {}) {
    const journal = this.readJournal();
    return findMaterializationByCandidate(journal, candidateId);
  }

  listMaterializations() {
    const journal = this.readJournal();
    return {
      summary: summarizeMaterializations(journal),
      materializations: [...journal.events],
    };
  }
}

module.exports = {
  OwnerRuleMaterializationService,
  OwnerRuleMaterializationServiceError,
  journalEvent,
};
