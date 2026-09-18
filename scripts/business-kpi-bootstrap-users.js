'use strict';

const { AuthService } = require('../apps/business-kpi-web/application/auth_service');
const {
  bootstrapStoreUsers,
} = require('../apps/business-kpi-web/application/bootstrap_store_users');
const { loadConfig } = require('../apps/business-kpi-web/config');
const {
  PostgresBusinessKpiStore,
} = require('../apps/business-kpi-web/storage/postgres_business_kpi_store');

async function main() {
  const config = loadConfig(process.env);
  if (config.storageMode !== 'postgresql') {
    throw new Error('Bootstrap пользователей разрешён только для PostgreSQL.');
  }
  const store = new PostgresBusinessKpiStore({ databaseUrl: config.databaseUrl });
  try {
    await store.checkHealth();
    const authService = new AuthService({ store });
    const results = await bootstrapStoreUsers({
      store,
      authService,
      env: process.env,
    });    for (const result of results) {
      console.log(
        `Business KPI user ${result.action}: ${result.externalId} (${result.storeCode})`
      );
    }
    if (!results.length) {
      console.log('Business KPI users: bootstrap secrets not supplied; nothing changed.');
    }
  } finally {
    await store.close();
  }
}

main().catch(error => {
  console.error('Business KPI user bootstrap failed:', error.message);
  process.exitCode = 1;
});
