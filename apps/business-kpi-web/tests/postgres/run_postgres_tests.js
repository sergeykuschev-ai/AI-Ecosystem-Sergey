'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { requirePostgresTestEnvironment } = require('./postgres_test_guard');

function main() {
  try {
    requirePostgresTestEnvironment();
  } catch (error) {
    console.error(`PostgreSQL integration configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const testFile = path.join(__dirname, 'postgres_integration.test.js');
  const result = spawnSync(process.execPath, ['--test', testFile], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`PostgreSQL integration runner failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) main();

module.exports = { main };
