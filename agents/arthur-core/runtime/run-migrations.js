'use strict';

const { runMigrations } = require('./migration_runner');

async function main() {
  try {
    await runMigrations();
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'migration',
      message: error.message,
    }));
    process.exitCode = 1;
  }
}

main();
