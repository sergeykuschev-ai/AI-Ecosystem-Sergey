'use strict';

const { runMigrations } = require('./migration_runner');

async function main() {
  try {
    const result = await runMigrations();
    console.log(JSON.stringify({
      event: 'business_kpi_migrations_complete',
      ...result,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'business_kpi_migrations_failed',
      errorMessage: error.message,
    }));
    process.exitCode = 1;
  }
}

module.exports = { main };

if (require.main === module) {
  main();
}
