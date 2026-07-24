const http = require('node:http');

const {
  DEFAULT_HTTP_HOST,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNS_ROOT,
  DEFAULT_SERVER_PATHS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_UPLOAD_ROOT,
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
  FileRunRegistry,
} = require('./storage/file_run_registry');
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
  const registry = options.registry || new FileRunRegistry({
    runsRoot: options.runsRoot || DEFAULT_RUNS_ROOT,
    ownerLearningHistoryPath: options.ownerLearningHistoryPath || (
      options.runsRoot
        ? undefined
        : serverPaths.ownerLearningHistoryPath
    ),
    approvedRulesPath: options.approvedRulesPath ||
      serverPaths.approvedRulesPath,
    logger: options.logger,
  });
  const ownerDecisionService = options.ownerDecisionService ||
    new OwnerDecisionService({
      registry,
      ownerDecisionsPath: serverPaths.ownerDecisionsPath,
      now: options.now,
    });
  const queryService = options.queryService ||
    new RunQueryService(registry, { ownerDecisionService });
  const handlers = options.handlers || createRunHandlers({
    registry,
    queryService,
    orchestrator: options.orchestrator,
    uploadRoot: options.uploadRoot || DEFAULT_UPLOAD_ROOT,
    serverPaths,
    uploadOptions: options.uploadOptions,
    runLock: options.runLock,
  });
  const staticHandler = options.staticHandler || createStaticHandler({
    publicRoot: options.publicRoot,
  });
  const router = createRouter(handlers, {
    ...options.routerOptions,
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
  server.listen(port, DEFAULT_HTTP_HOST);
  return server;
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
  const server = startPurchasingWebServer();
  installGracefulShutdown({ server });
  server.once('listening', () => {
    const address = server.address();
    console.log(
      `Purchasing Web API v1: http://${DEFAULT_HTTP_HOST}:${address.port}`
    );
  });
}

module.exports = {
  createPurchasingWebServer,
  installGracefulShutdown,
  runStartupCleanup,
  safeCleanupLog,
  startPurchasingWebServer,
};
