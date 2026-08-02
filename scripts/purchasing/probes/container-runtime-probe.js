'use strict';

const fs = require('node:fs');
const { printSelfBytes } = require('../container-probe-runner');

if (!printSelfBytes(module)) {
  const requiredFiles = [
    '/app/package.json',
    '/app/package-lock.json',
    '/app/apps/purchasing-web-backend/server.js',
    '/app/agents/purchasing/order_agent.js',
    '/app/shared/reporting/xlsx_exporter.js',
  ];
  for (const file of requiredFiles) fs.accessSync(file, fs.constants.R_OK);
  for (const directory of ['/app/output', '/app/data/purchasing']) {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  }
  for (const moduleName of ['busboy', 'fflate', 'read-excel-file']) {
    require.resolve(moduleName);
  }
  process.stdout.write('runtime-ok');
}
