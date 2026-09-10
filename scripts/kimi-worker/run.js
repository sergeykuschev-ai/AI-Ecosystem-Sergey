#!/usr/bin/env node
'use strict';

const path = require('path');
const config = require('./config');
const { acquire } = require('./lock');
const { createLogger } = require('./logger');
const worker = require('./worker');

function parseArgs(argv) {
  const opts = { dryRun: undefined, issue: null, setupCheck: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-dry-run') opts.dryRun = false;
    else if (arg === '--setup-check') opts.setupCheck = true;
    else if (arg === '--issue') opts.issue = parseInt(argv[++i], 10);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      opts.help = true;
    }
  }
  return opts;
}

const USAGE = `Kimi autonomous worker (V1)

Usage:
  node scripts/kimi-worker/run.js [--dry-run] [--issue N]   process one eligible issue (default)
  node scripts/kimi-worker/run.js --setup-check             verify environment without side effects
  node scripts/kimi-worker/run.js --help

Environment:
  AIKIMI_DRY_RUN=1        force dry-run (no GitHub labels/comments/PRs, no git mutations)
  AIKIMI_REPO             default ${config.repo}
  AIKIMI_WORKER_HOME      default ${config.workerHome}
  AIKIMI_KIMI_TIMEOUT_MS  default ${config.kimi.timeoutMs}
  AIKIMI_SKIP_BUILD=1     skip npm run build in checks
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const logger = createLogger(config.logsDir, 'worker');
  logger.info(`Kimi worker starting (pid ${process.pid}), dry-run=${opts.dryRun !== undefined ? opts.dryRun : config.dryRun}`);

  let release = null;
  try {
    release = acquire(config.lockPath);
    if (!release) {
      logger.warn(`Another worker holds ${config.lockPath}. Exiting.`);
      process.exit(0);
    }
  } catch (err) {
    logger.error(`Lock error: ${err.message}`);
    process.exit(1);
  }

  const shutdown = (signal) => {
    logger.warn(`Received ${signal}; finishing current step, then exiting.`);
    setTimeout(() => process.exit(130), 1500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    let exitCode = 0;
    if (opts.setupCheck) {
      exitCode = (await worker.setupCheck(logger)) ? 0 : 1;
    } else if (opts.issue) {
      const result = await worker.processIssue(opts.issue, logger, { dryRun: opts.dryRun !== undefined ? opts.dryRun : config.dryRun });
      logger.info(`Result for issue #${opts.issue}: ${JSON.stringify(result)}`);
      exitCode = result.status === 'error' ? 1 : 0;
    } else {
      const result = await worker.runOnce(logger, { dryRun: opts.dryRun });
      logger.info(`Run result: ${JSON.stringify(result)}`);
      exitCode = result.status === 'error' ? 1 : 0;
    }
    release();
    logger.info(`Kimi worker finished (log: ${path.basename(logger.path)}).`);
    logger.close();
    process.exit(exitCode);
  } catch (err) {
    logger.error(`Fatal: ${err.message}`);
    if (release) release();
    logger.close();
    process.exit(1);
  }
}

main();
