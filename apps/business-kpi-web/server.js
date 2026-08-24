'use strict';

const http = require('node:http');

const { AuthService } = require('./application/auth_service');
const { BusinessKpiService } = require('./application/business_kpi_service');
const { HealthService } = require('./application/health_service');
const { WorkbookImportService } = require('./application/workbook_import_service');
const { loadConfig } = require('./config');
const { createRouter } = require('./http/router');
const { createStaticHandler } = require('./http/static_handler');
const {
  InMemoryBusinessKpiStore,
} = require('./storage/in_memory_business_kpi_store');
const {
  PostgresBusinessKpiStore,
} = require('./storage/postgres_business_kpi_store');

function createBusinessKpiWebServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const store = options.store || (config.storageMode === 'postgresql'
    ? new PostgresBusinessKpiStore({ databaseUrl: config.databaseUrl })
    : new InMemoryBusinessKpiStore());
  const healthService = options.healthService || new HealthService({
    databaseSchema: config.databaseSchema,
    devMode: config.devMode,
    storageProvider: config.storageMode,
    checkStorage: () => store.checkHealth(),
  });
  const businessKpiService = options.businessKpiService ||
    new BusinessKpiService({ store, now: options.now, uuid: options.uuid });
  const workbookImportService = options.workbookImportService ||
    new WorkbookImportService({
      store,
      businessKpiService,
      now: options.now,
      uuid: options.uuid,
    });
  const authService = options.authService || new AuthService({ store });
  const staticHandler = options.staticHandler ||
    createStaticHandler(config.publicRoot);
  const route = createRouter({
    authService,
    businessKpiService,
    workbookImportService,
    devMode: config.devMode,
    cookieSecure: config.cookieSecure,
    healthService,
    staticHandler,
  });

  const server = http.createServer((request, response) => {
    Promise.resolve(route(request, response)).catch(error => {
      console.error('Business KPI Web request failed', {
        method: request.method,
        path: String(request.url || '').split('?')[0],
        errorMessage: error.message,
      });
      if (!response.headersSent) {
        response.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
        });
      }
      response.end(JSON.stringify({
        api_version: 'v1',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Внутренняя ошибка сервера.',
        },
      }));
    });
  });
  server.businessKpiStore = store;
  return server;
}

async function startBusinessKpiWebServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const server = createBusinessKpiWebServer({ ...options, config });
  try {
    if (config.storageMode === 'postgresql') {
      await server.businessKpiStore.checkHealth();
    }
    if (config.seedReferenceData &&
        typeof server.businessKpiStore.ensureDevReferenceData === 'function') {
      await server.businessKpiStore.ensureDevReferenceData();
    }
  } catch (error) {
    await server.businessKpiStore.close();
    throw error;
  }
  server.listen(config.port, config.host, () => {
    const address = server.address();
    console.log(
      `Business KPI Web listening on http://${address.address}:${address.port}`
    );
  });
  server.once('close', () => {
    Promise.resolve(server.businessKpiStore.close()).catch(error => {
      console.error('Business KPI storage close failed', {
        errorMessage: error.message,
      });
    });
  });
  return server;
}

module.exports = {
  createBusinessKpiWebServer,
  startBusinessKpiWebServer,
};

if (require.main === module) {
  startBusinessKpiWebServer().catch(error => {
    console.error('Business KPI Web startup failed', {
      errorMessage: error.message,
    });
    process.exitCode = 1;
  });
}
