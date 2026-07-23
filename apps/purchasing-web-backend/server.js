const http = require('node:http');

const {
  DEFAULT_HTTP_HOST,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNS_ROOT,
  DEFAULT_SERVER_PATHS,
  DEFAULT_UPLOAD_ROOT,
  resolveHttpPort,
} = require('./config');
const {
  RunQueryService,
} = require('./application/run_query_service');
const {
  FileRunRegistry,
} = require('./storage/file_run_registry');
const { createRouter } = require('./http/router');
const { createRunHandlers } = require('./http/run_handlers');

function createPurchasingWebServer(options = {}) {
  const registry = options.registry || new FileRunRegistry({
    runsRoot: options.runsRoot || DEFAULT_RUNS_ROOT,
  });
  const queryService = options.queryService ||
    new RunQueryService(registry);
  const handlers = options.handlers || createRunHandlers({
    registry,
    queryService,
    orchestrator: options.orchestrator,
    uploadRoot: options.uploadRoot || DEFAULT_UPLOAD_ROOT,
    serverPaths: options.serverPaths || DEFAULT_SERVER_PATHS,
    uploadOptions: options.uploadOptions,
  });
  const router = createRouter(handlers, options.routerOptions);
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
  const server = createPurchasingWebServer(options);
  const port = options.port ?? resolveHttpPort();
  server.listen(port, DEFAULT_HTTP_HOST);
  return server;
}

if (require.main === module) {
  const server = startPurchasingWebServer();
  server.once('listening', () => {
    const address = server.address();
    console.log(
      `Purchasing Web API v1: http://${DEFAULT_HTTP_HOST}:${address.port}`
    );
  });
}

module.exports = {
  createPurchasingWebServer,
  startPurchasingWebServer,
};
