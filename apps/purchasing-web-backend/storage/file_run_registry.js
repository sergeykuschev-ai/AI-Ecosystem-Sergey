const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_RUNS_ROOT,
  isValidRunId,
} = require('../config');
const {
  buildOwnerLearningPatterns,
  buildOwnerLearningPatternsMarkdown,
  unavailablePatterns,
  unavailablePatternsMarkdown,
  updateOwnerLearningHistory,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_history'
);
const {
  buildOwnerRuleProposals,
  buildOwnerRuleProposalsMarkdown,
  unavailableOwnerRuleProposals,
  unavailableOwnerRuleProposalsMarkdown,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_proposals'
);
const {
  DEFAULT_REGISTRY_PATH: DEFAULT_APPROVED_RULES_PATH,
  loadApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  buildApprovedRulePreview,
  buildApprovedRulePreviewMarkdown,
  unavailableApprovedRulePreview,
  unavailableApprovedRulePreviewMarkdown,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_preview'
);
const { mapOwnerReview } = require('../dto/owner_review_mapper');
const {
  mapPurchasingItems,
} = require('../dto/purchasing_item_mapper');
const { mapRunStatus } = require('../dto/run_status_mapper');
const { mapRunSummary } = require('../dto/run_summary_mapper');
const {
  FileArtifactStore,
  atomicWriteFile,
  serializeJson,
} = require('./file_artifact_store');

const PUBLISHED_JSON_FILES = Object.freeze([
  'summary.json',
  'items.json',
  'owner-review-compact.json',
]);

class RunRegistryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'RunRegistryError';
    this.code = code;
  }
}

function assertRunId(runId) {
  if (!isValidRunId(runId)) {
    throw new RunRegistryError(
      'INVALID_RUN_ID',
      'Run ID должен быть корректным UUID.'
    );
  }
}

function readJson(fsModule, filePath, notFoundCode) {
  try {
    return JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new RunRegistryError(
      error.code === 'ENOENT' ? notFoundCode : 'RUN_DATA_INVALID',
      error.code === 'ENOENT'
        ? 'Запрошенные данные run не найдены.'
        : 'Сохранённые данные run повреждены.',
      { cause: error }
    );
  }
}

class FileRunRegistry {
  constructor(options = {}) {
    this.runsRoot = path.resolve(options.runsRoot || DEFAULT_RUNS_ROOT);
    this.fs = options.fsModule || fs;
    this.ownerLearningHistoryPath = path.resolve(
      options.ownerLearningHistoryPath ||
      path.join(this.runsRoot, 'owner-learning-history.json')
    );
    this.approvedRulesPath = path.resolve(
      options.approvedRulesPath || DEFAULT_APPROVED_RULES_PATH
    );
    this.approvedRulesLoader = options.approvedRulesLoader ||
      loadApprovedRules;
    this.logger = options.logger || console;
    this.artifactStore = options.artifactStore || new FileArtifactStore({
      runsRoot: this.runsRoot,
      fsModule: this.fs,
    });
  }

  runDirectory(runId) {
    assertRunId(runId);
    return path.join(this.runsRoot, runId);
  }

  runFile(runId, name) {
    return path.join(this.runDirectory(runId), name);
  }

  writeJson(runId, name, value) {
    atomicWriteFile(
      this.runFile(runId, name),
      serializeJson(value),
      { fsModule: this.fs }
    );
  }

  createProcessingRun(input) {
    assertRunId(input?.runId);
    this.fs.mkdirSync(this.runsRoot, { recursive: true });
    const runDirectory = this.runDirectory(input.runId);
    try {
      this.fs.mkdirSync(runDirectory);
    } catch (error) {
      throw new RunRegistryError(
        error.code === 'EEXIST' ? 'RUN_ALREADY_EXISTS' : 'RUN_STORAGE_ERROR',
        error.code === 'EEXIST'
          ? 'Run с таким ID уже существует.'
          : 'Не удалось создать run.',
        { cause: error }
      );
    }
    const status = mapRunStatus({
      runId: input.runId,
      status: 'processing',
      stage: input.stage || 'purchasing',
      createdAt: input.createdAt,
      startedAt: input.startedAt || input.createdAt,
      completedAt: null,
      source: input.source,
      warningsCount: 0,
    });
    this.writeJson(input.runId, 'run.json', status);
    return status;
  }

  saveCompletedRun(bundle, options = {}) {
    assertRunId(bundle?.run_id);
    const current = this.getRunStatus(bundle.run_id);
    if (current.status !== 'processing') {
      throw new RunRegistryError(
        'RUN_STATE_CONFLICT',
        'Завершить можно только processing run.'
      );
    }

    try {
      const summary = mapRunSummary(bundle);
      const items = mapPurchasingItems(bundle);
      const ownerReview = mapOwnerReview(bundle);
      let bundleWithPatterns;
      try {
        const historyResult = updateOwnerLearningHistory(
          this.ownerLearningHistoryPath,
          bundle.ownerLearningHistoryEntry,
          { fsModule: this.fs }
        );
        const patterns = buildOwnerLearningPatterns(
          historyResult.history,
          bundle.generated_at
        );
        bundleWithPatterns = {
          ...bundle,
          ownerLearningPatterns: patterns,
          ownerLearningPatternsReport:
            buildOwnerLearningPatternsMarkdown(patterns),
        };
      } catch (historyError) {
        const historyErrorCode = historyError.code || 'HISTORY_UNAVAILABLE';
        try {
          this.logger.error(
            `Owner Learning History: ${historyErrorCode}.`
          );
        } catch {}
        bundleWithPatterns = {
          ...bundle,
          ownerLearningPatterns: unavailablePatterns(
            bundle.generated_at,
            historyErrorCode
          ),
          ownerLearningPatternsReport: unavailablePatternsMarkdown(),
        };
      }
      let bundleWithProposals;
      try {
        const proposals = buildOwnerRuleProposals(
          bundleWithPatterns.ownerLearningPatterns,
          { generatedAt: bundle.generated_at }
        );
        bundleWithProposals = {
          ...bundleWithPatterns,
          ownerRuleProposals: proposals,
          ownerRuleProposalsReport:
            buildOwnerRuleProposalsMarkdown(proposals),
        };
      } catch (proposalError) {
        const proposalErrorCode = proposalError.code ||
          'PROPOSALS_UNAVAILABLE';
        try {
          this.logger.error(
            `Owner Rule Proposals: ${proposalErrorCode}.`
          );
        } catch {}
        bundleWithProposals = {
          ...bundleWithPatterns,
          ownerRuleProposals: unavailableOwnerRuleProposals(
            bundle.generated_at,
            bundleWithPatterns.ownerLearningPatterns?.reportVersion,
            proposalErrorCode
          ),
          ownerRuleProposalsReport:
            unavailableOwnerRuleProposalsMarkdown(),
        };
      }
      let bundleWithPreview;
      try {
        const approvedRules = this.approvedRulesLoader({
          registryPath: this.approvedRulesPath,
          fsModule: this.fs,
          logger: { error() {} },
        });
        const preview = buildApprovedRulePreview({
          agentResult: bundle.agentResult,
          approvedRules,
          generatedAt: bundle.generated_at,
        });
        bundleWithPreview = {
          ...bundleWithProposals,
          approvedRulePreview: preview,
          approvedRulePreviewReport:
            buildApprovedRulePreviewMarkdown(preview),
        };
      } catch (previewError) {
        const previewErrorCode = previewError.code ||
          'APPROVED_RULE_PREVIEW_UNAVAILABLE';
        try {
          this.logger.error(
            `Approved Rule Preview: ${previewErrorCode}.`
          );
        } catch {}
        bundleWithPreview = {
          ...bundleWithProposals,
          approvedRulePreview: unavailableApprovedRulePreview(
            bundle.generated_at,
            previewErrorCode
          ),
          approvedRulePreviewReport:
            unavailableApprovedRulePreviewMarkdown(),
        };
      }
      const manifest = this.artifactStore.saveBundleArtifacts(
        bundleWithPreview
      );

      this.writeJson(bundle.run_id, 'summary.json', summary);
      this.writeJson(bundle.run_id, 'items.json', items);
      this.writeJson(
        bundle.run_id,
        'owner-review-compact.json',
        ownerReview
      );
      const completedStatus = mapRunStatus({
        runId: bundle.run_id,
        status: 'completed',
        stage: 'complete',
        createdAt: current.created_at,
        startedAt: current.started_at,
        completedAt: options.completedAt || bundle.generated_at,
        source: current.source,
        warningsCount: summary.warnings.length,
      });
      this.writeJson(bundle.run_id, 'run.json', completedStatus);
      return {
        status: completedStatus,
        summary,
        items,
        ownerReview,
        manifest,
      };
    } catch (error) {
      try {
        this.removePublishedPayload(bundle.run_id);
      } catch {}
      throw new RunRegistryError(
        'RUN_STORAGE_ERROR',
        'Не удалось атомарно сохранить completed run.',
        { cause: error }
      );
    }
  }

  removePublishedPayload(runId) {
    PUBLISHED_JSON_FILES.forEach(name => {
      this.fs.rmSync(this.runFile(runId, name), { force: true });
    });
    this.artifactStore.removeArtifacts(runId);
  }

  saveFailedRun(runId, error, options = {}) {
    assertRunId(runId);
    let current;
    try {
      current = this.getRunStatus(runId);
    } catch (readError) {
      if (readError.code !== 'RUN_NOT_FOUND') throw readError;
      this.fs.mkdirSync(this.runDirectory(runId), { recursive: true });
      current = {
        created_at: options.createdAt || null,
        started_at: options.startedAt || options.createdAt || null,
        source: options.source || {},
      };
    }
    this.removePublishedPayload(runId);
    const failedStatus = mapRunStatus({
      runId,
      status: 'failed',
      stage: options.stage || 'failed',
      createdAt: current.created_at,
      startedAt: current.started_at,
      completedAt: options.completedAt || null,
      source: current.source,
      warningsCount: 0,
      error,
      requestId: options.requestId,
      errorDetails: options.details,
    });
    this.writeJson(runId, 'run.json', failedStatus);
    return failedStatus;
  }

  getRunStatus(runId) {
    return readJson(
      this.fs,
      this.runFile(runId, 'run.json'),
      'RUN_NOT_FOUND'
    );
  }

  getRunSummary(runId) {
    return readJson(
      this.fs,
      this.runFile(runId, 'summary.json'),
      'RUN_SUMMARY_NOT_FOUND'
    );
  }

  getItems(runId) {
    return readJson(
      this.fs,
      this.runFile(runId, 'items.json'),
      'RUN_ITEMS_NOT_FOUND'
    );
  }

  getOwnerReview(runId) {
    return readJson(
      this.fs,
      this.runFile(runId, 'owner-review-compact.json'),
      'OWNER_REVIEW_NOT_FOUND'
    );
  }

  listArtifacts(runId) {
    return this.artifactStore.readManifest(runId).artifacts;
  }
}

module.exports = {
  FileRunRegistry,
  PUBLISHED_JSON_FILES,
  RunRegistryError,
  assertRunId,
  readJson,
};
