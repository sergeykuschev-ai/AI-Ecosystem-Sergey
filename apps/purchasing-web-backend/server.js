const http = require('node:http');
const path = require('node:path');

const {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNS_ROOT,
  DEFAULT_SERVER_PATHS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_UPLOAD_IDEMPOTENCY_PATH,
  DEFAULT_UPLOAD_ROOT,
  MINMAX_HTTP_CONTRACT_VERSION,
  resolveApiToken,
  resolveApprovedRuleMode,
  resolveBuildSha,
  resolveHttpHost,
  resolveHttpPort,
  resolveRetentionTtlMs,
} = require('./config');
const {
  RunQueryService,
} = require('./application/run_query_service');
const {
  OwnerDecisionService,
} = require('./application/owner_decision_service');
const {
  OwnerDecisionAnalyticsService,
} = require('./application/owner_decision_analytics_service');
const {
  OwnerLearningCandidatesService,
} = require('./application/owner_learning_candidates_service');
const {
  OwnerLearningCandidateLifecycleService,
} = require(
  './application/owner_learning_candidate_lifecycle_service'
);
const {
  OwnerRuleMaterializationService,
} = require('./application/owner_rule_materialization_service');
const {
  OwnerMaterializedRulesService,
} = require('./application/owner_materialized_rules_service');
const {
  OwnerRuleActivationPreviewService,
} = require('./application/owner_rule_activation_preview_service');
const {
  OwnerRuleStatusService,
} = require('./application/owner_rule_status_service');
const {
  OwnerRuleEffectivenessService,
} = require('./application/owner_rule_effectiveness_service');
const {
  OwnerLearningCenterService,
} = require('./application/owner_learning_center_service');
const {
  OwnerKnowledgeHealthService,
} = require('./application/owner_knowledge_health_service');
const {
  SupplierOrderService,
} = require('./application/supplier_order_service');
const {
  FileRunRegistry,
} = require('./storage/file_run_registry');
const {
  UploadIdempotencyStore,
} = require('./storage/upload_idempotency_store');
const { createRouter } = require('./http/router');
const { createRunHandlers } = require('./http/run_handlers');
const { createStaticHandler } = require('./http/static_handler');
const {
  cleanupExpiredRuns,
  cleanupStaleUploads,
} = require('./storage/retention_cleanup');

function safeCleanupLog(logger, message) {
  if (logger && typeof logger.warn === 'function') logger.warn(message);
}

function runStartupCleanup(options = {}) {
  const logger = options.logger || console;
  let runCleanup = null;
  let uploadCleanup = null;
  try {
    runCleanup = cleanupExpiredRuns({
      runsRoot: options.runsRoot || DEFAULT_RUNS_ROOT,
      ttlMs: options.retentionTtlMs ?? resolveRetentionTtlMs(),
      now: options.now,
    });
    if (runCleanup.errors > 0) {
      safeCleanupLog(
        logger,
        'Purchasing Web cleanup: часть run-каталогов не обработана.'
      );
    }
  } catch {
    safeCleanupLog(
      logger,
      'Purchasing Web cleanup: не удалось очистить устаревшие runs.'
    );
  }
  try {
    uploadCleanup = cleanupStaleUploads({
      uploadRoot: options.uploadRoot || DEFAULT_UPLOAD_ROOT,
    });
    if (uploadCleanup.errors > 0) {
      safeCleanupLog(
        logger,
        'Purchasing Web cleanup: часть временных uploads не обработана.'
      );
    }
  } catch {
    safeCleanupLog(
      logger,
      'Purchasing Web cleanup: не удалось очистить временные uploads.'
    );
  }
  return { runs: runCleanup, uploads: uploadCleanup };
}

function createPurchasingWebServer(options = {}) {
  const serverPaths = options.serverPaths || DEFAULT_SERVER_PATHS;
  const lifecycleFilePath =
    options.ownerLearningCandidateLifecycleFilePath ||
    serverPaths.ownerLearningCandidateLifecycleFilePath ||
    DEFAULT_SERVER_PATHS.ownerLearningCandidateLifecycleFilePath;
  const materializationsFilePath =
    options.ownerLearningRuleMaterializationsFilePath ||
    serverPaths.ownerLearningRuleMaterializationsFilePath ||
    DEFAULT_SERVER_PATHS.ownerLearningRuleMaterializationsFilePath;
  const approvedRulesPath = options.approvedRulesPath ||
    serverPaths.approvedRulesPath ||
    DEFAULT_SERVER_PATHS.approvedRulesPath;
  const statusEventsFilePath =
    options.ownerLearningRuleStatusEventsFilePath ||
    serverPaths.ownerLearningRuleStatusEventsFilePath ||
    DEFAULT_SERVER_PATHS.ownerLearningRuleStatusEventsFilePath;
  const activationPreviewsFilePath =
    options.ownerLearningRuleActivationPreviewsFilePath ||
    serverPaths.ownerLearningRuleActivationPreviewsFilePath ||
    DEFAULT_SERVER_PATHS.ownerLearningRuleActivationPreviewsFilePath;
  const effectivenessFilePath =
    options.ownerLearningRuleEffectivenessFilePath ||
    serverPaths.ownerLearningRuleEffectivenessFilePath ||
    DEFAULT_SERVER_PATHS.ownerLearningRuleEffectivenessFilePath;
  const runsRoot = options.runsRoot || DEFAULT_RUNS_ROOT;
  const registry = options.registry || new FileRunRegistry({
    runsRoot,
    ownerLearningHistoryPath: options.ownerLearningHistoryPath || (
      options.runsRoot
        ? undefined
        : serverPaths.ownerLearningHistoryPath
    ),
    approvedRulesPath,
    logger: options.logger,
  });
  const ownerDecisionService = options.ownerDecisionService ||
    new OwnerDecisionService({
      registry,
      ownerDecisionsPath: serverPaths.ownerDecisionsPath,
      ownerDecisionHistoryPath:
        serverPaths.ownerDecisionHistoryPath,
      applicationMode: options.approvedRuleMode ??
        resolveApprovedRuleMode(),
      logger: options.logger,
      now: options.now,
    });
  const queryService = options.queryService ||
    new RunQueryService(registry, { ownerDecisionService });
  const ownerDecisionAnalyticsService =
    options.ownerDecisionAnalyticsService ||
    new OwnerDecisionAnalyticsService({
      historyFilePath: options.ownerDecisionHistoryFilePath ||
        serverPaths.ownerDecisionHistoryPath,
      logger: options.logger,
      now: options.now,
    });
  const ownerLearningCandidatesService =
    options.ownerLearningCandidatesService ||
    new OwnerLearningCandidatesService({
      historyFilePath: options.ownerDecisionHistoryFilePath ||
        serverPaths.ownerDecisionHistoryPath,
      lifecycleFilePath,
      materializationsFilePath,
      logger: options.logger,
      now: options.now,
    });
  const ownerLearningCandidateLifecycleService =
    options.ownerLearningCandidateLifecycleService ||
    new OwnerLearningCandidateLifecycleService({
      lifecycleFilePath,
      candidatesService: ownerLearningCandidatesService,
      logger: options.logger,
      now: options.now,
    });
  const ownerRuleMaterializationService =
    options.ownerRuleMaterializationService ||
    new OwnerRuleMaterializationService({
      candidatesService: ownerLearningCandidatesService,
      lifecycleService: ownerLearningCandidateLifecycleService,
      materializationsFilePath,
      registryPath: approvedRulesPath,
      logger: options.logger,
      now: options.now,
    });
  const ownerMaterializedRulesService =
    options.ownerMaterializedRulesService ||
    new OwnerMaterializedRulesService({
      approvedRulesFilePath: approvedRulesPath,
      materializationsFilePath,
      candidateLifecycleFilePath: lifecycleFilePath,
      statusEventsFilePath,
      effectivenessFilePath,
      candidatesService: ownerLearningCandidatesService,
      logger: options.logger,
      now: options.now,
    });
  const ownerRuleEffectivenessService =
    options.ownerRuleEffectivenessService ||
    new OwnerRuleEffectivenessService({
      effectivenessFilePath,
      approvedRulesFilePath: approvedRulesPath,
      logger: options.logger,
      now: options.now,
    });
  const ownerKnowledgeHealthService =
    options.ownerKnowledgeHealthService ||
    new OwnerKnowledgeHealthService({
      materializedRulesService:
        typeof ownerMaterializedRulesService
          .getKnowledgeHealthSnapshot === 'function'
          ? ownerMaterializedRulesService
          : {
            getKnowledgeHealthSnapshot() {
              return {
                status: 'UNAVAILABLE',
                warnings: ['OWNER_KNOWLEDGE_HEALTH_UNAVAILABLE'],
              };
            },
          },
      logger: options.logger,
      now: options.now,
    });
  const ownerLearningCenterService =
    options.ownerLearningCenterService ||
    new OwnerLearningCenterService({
      decisionAnalyticsService: ownerDecisionAnalyticsService,
      candidatesService: ownerLearningCandidatesService,
      candidateLifecycleService:
        ownerLearningCandidateLifecycleService,
      materializedRulesService: ownerMaterializedRulesService,
      ruleEffectivenessService: ownerRuleEffectivenessService,
      knowledgeHealthService: ownerKnowledgeHealthService,
      logger: options.logger,
      now: options.now,
    });
  const ownerRuleActivationPreviewService =
    options.ownerRuleActivationPreviewService ||
    new OwnerRuleActivationPreviewService({
      approvedRulesFilePath: approvedRulesPath,
      previewStorageFilePath: activationPreviewsFilePath,
      runsRoot,
      logger: options.logger,
      now: options.now,
    });
  const ownerRuleStatusService =
    options.ownerRuleStatusService ||
    new OwnerRuleStatusService({
      approvedRulesFilePath: approvedRulesPath,
      statusEventsFilePath,
      previewStorageFilePath: activationPreviewsFilePath,
      previewService: ownerRuleActivationPreviewService,
      logger: options.logger,
      now: options.now,
    });
  // Durable upload idempotency registry: pass null explicitly to
  // disable, otherwise it lives next to runsRoot (tests) or in the
  // runtime output directory (default server).
  const uploadIdempotencyStore =
    options.uploadIdempotencyStore !== undefined
      ? options.uploadIdempotencyStore
      : new UploadIdempotencyStore({
        filePath: options.uploadIdempotencyPath || (
          options.runsRoot
            ? path.join(
              path.dirname(options.runsRoot),
              'upload-idempotency.json'
            )
            : DEFAULT_UPLOAD_IDEMPOTENCY_PATH
        ),
        now: options.now,
      });
  const handlers = options.handlers || createRunHandlers({
    registry,
    queryService,
    orchestrator: options.orchestrator,
    uploadRoot: options.uploadRoot || DEFAULT_UPLOAD_ROOT,
    serverPaths,
    uploadOptions: options.uploadOptions,
    runLock: options.runLock,
    approvedRuleMode: options.approvedRuleMode ??
      resolveApprovedRuleMode(),
    ownerDecisionAnalyticsService,
    ownerLearningCandidatesService,
    ownerLearningCandidateLifecycleService,
    ownerRuleMaterializationService,
    ownerMaterializedRulesService,
    ownerRuleEffectivenessService,
    ownerKnowledgeHealthService,
    ownerRuleStatusService,
    ownerLearningCenterService,
    supplierOrderService: options.supplierOrderService ||
      new SupplierOrderService({
        queryService,
        registry,
        now: options.now,
      }),
    uploadIdempotencyStore,
    backendBuildSha: options.backendBuildSha !== undefined
      ? options.backendBuildSha
      : resolveBuildSha(),
    logger: options.logger,
  });
  const staticHandler = options.staticHandler || createStaticHandler({
    publicRoot: options.publicRoot,
  });
  const router = createRouter(handlers, {
    ...options.routerOptions,
    apiToken: options.apiToken !== undefined
      ? options.apiToken
      : resolveApiToken(),
    staticHandler,
  });
  const server = http.createServer((request, response) => {
    router(request, response);
  });
  const requestTimeoutMs = options.requestTimeoutMs ||
    DEFAULT_REQUEST_TIMEOUT_MS;
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 30 * 1000);
  server.keepAliveTimeout = 5 * 1000;
  return server;
}

function startPurchasingWebServer(options = {}) {
  runStartupCleanup(options);
  const server = createPurchasingWebServer(options);
  const port = options.port ?? resolveHttpPort();
  // Default stays loopback-only; production sets PURCHASING_WEB_HOST
  // explicitly together with PURCHASING_API_TOKEN.
  const host = options.host ?? resolveHttpHost();
  server.listen(port, host);
  return server;
}

function runContainerHealthcheck(options = {}) {
  const httpModule = options.httpModule || http;
  const expectedSha = options.expectedSha ?? resolveBuildSha();
  const apiToken = options.apiToken ?? resolveApiToken();
  return new Promise((resolve, reject) => {
    const fail = message => reject(new Error(`healthcheck failed: ${message}`));
    const request = httpModule.get({
      hostname: '127.0.0.1',
      port: 3210,
      path: '/api/v1/health',
      headers: {
        accept: 'application/json',
        ...(apiToken ? { 'x-api-key': apiToken } : {}),
      },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) {
          request.destroy(new Error('response exceeds 65536 bytes'));
        }
      });
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          fail(
            `non-JSON response: HTTP ${response.statusCode} ` +
            `body=${JSON.stringify(body.slice(0, 240))}`
          );
          return;
        }
        const errors = [];
        if (response.statusCode !== 200) {
          errors.push(`HTTP ${response.statusCode}`);
        }
        if (payload?.data?.service !== 'purchasing-web') {
          errors.push(`service=${JSON.stringify(payload?.data?.service)}`);
        }
        if (payload?.data?.build_sha !== expectedSha) {
          errors.push(
            `build_sha=${JSON.stringify(payload?.data?.build_sha)} ` +
            `expected=${JSON.stringify(expectedSha)}`
          );
        }
        if (errors.length > 0) {
          fail(errors.join('; '));
          return;
        }
        resolve(payload);
      });
    });
    request.setTimeout(4000, () => {
      request.destroy(new Error('request timeout'));
    });
    request.on('error', error => fail(error.message));
  });
}

function installGracefulShutdown(options) {
  const {
    server,
    processObject = process,
    logger = console,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    exit = code => processObject.exit(code),
  } = options;
  if (!server || typeof server.close !== 'function') {
    throw new TypeError('HTTP server обязателен для graceful shutdown.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError('Shutdown timeout должен быть неотрицательным.');
  }

  let shuttingDown = false;
  let finished = false;
  let timer = null;
  let idleSweep = null;

  const removeListeners = () => {
    processObject.off('SIGINT', onSigint);
    processObject.off('SIGTERM', onSigterm);
  };
  const finish = code => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (idleSweep) clearInterval(idleSweep);
    removeListeners();
    exit(code);
  };
  const force = () => {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    finish(1);
  };
  const shutdown = signal => {
    if (shuttingDown) {
      safeCleanupLog(
        logger,
        'Purchasing Web shutdown: повторный сигнал, принудительное завершение.'
      );
      force();
      return;
    }
    shuttingDown = true;
    safeCleanupLog(
      logger,
      `Purchasing Web shutdown: получен ${signal}.`
    );
    timer = setTimeout(() => {
      safeCleanupLog(
        logger,
        'Purchasing Web shutdown: превышено время ожидания.'
      );
      force();
    }, timeoutMs);
    timer.unref();

    try {
      server.close(error => {
        if (error) {
          safeCleanupLog(
            logger,
            'Purchasing Web shutdown: ошибка закрытия HTTP server.'
          );
          finish(1);
          return;
        }
        finish(0);
      });
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
        idleSweep = setInterval(
          () => server.closeIdleConnections(),
          50
        );
        idleSweep.unref();
      }
    } catch {
      safeCleanupLog(
        logger,
        'Purchasing Web shutdown: HTTP server не удалось закрыть.'
      );
      finish(1);
    }
  };
  const onSigint = () => shutdown('SIGINT');
  const onSigterm = () => shutdown('SIGTERM');

  processObject.on('SIGINT', onSigint);
  processObject.on('SIGTERM', onSigterm);
  return {
    dispose() {
      if (timer) clearTimeout(timer);
      if (idleSweep) clearInterval(idleSweep);
      removeListeners();
    },
    isShuttingDown() {
      return shuttingDown;
    },
    shutdown,
  };
}

if (require.main === module) {
  if (process.argv[2] === '--healthcheck') {
    runContainerHealthcheck().catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } else {
    const server = startPurchasingWebServer();
    installGracefulShutdown({ server });
    server.once('listening', () => {
      const address = server.address();
      console.log(
        `Purchasing Web API v1: http://${resolveHttpHost()}:${address.port}; ` +
        `minmax_contract=${MINMAX_HTTP_CONTRACT_VERSION}; ` +
        `build_sha=${resolveBuildSha() || 'unknown'}`
      );
    });
  }
}

module.exports = {
  createPurchasingWebServer,
  installGracefulShutdown,
  runStartupCleanup,
  runContainerHealthcheck,
  safeCleanupLog,
  startPurchasingWebServer,
};
