'use strict';

// Delegates to the Arthur Core migration runner so it can resolve the pg dependency.
const path = require('node:path');

const runnerPath = path.resolve(__dirname, '..', '..', 'agents', 'arthur-core', 'runtime', 'run-migrations.js');
require(runnerPath);
