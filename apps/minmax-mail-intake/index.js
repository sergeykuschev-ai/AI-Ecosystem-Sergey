'use strict';

const { once } = require('node:events');

const { loadConfig } = require('./config');
const { createHealthServer } = require('./health_server');
const { ImapClient } = require('./imap_client');
const { NotificationMailer } = require('./notification_mailer');
const { PurchasingClient } = require('./purchasing_client');
const { MinmaxMailWorker } = require('./worker');

async function start(environment = process.env, dependencies = {}) {
  const config = dependencies.config || loadConfig(environment);
  const state = {
    imapConnected: false,
    lastPollAt: null,
    lastProcessedUid: null,
    lastSuccessfulRunId: null,
    lastError: null,
    lastEvent: null,
    eventCount: 0,
  };
  const worker = new MinmaxMailWorker({
    config,
    state,
    imapClient: dependencies.imapClient || new ImapClient(config.imap),
    purchasingClient: dependencies.purchasingClient ||
      new PurchasingClient(config.purchasing),
    mailer: dependencies.mailer || new NotificationMailer(config.smtp),
    logger: dependencies.logger || console,
  });
  const server = dependencies.server || createHealthServer(config, state);
  server.listen(config.healthPort, config.healthHost);
  await once(server, 'listening');
  const workerPromise = worker.run();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    worker.stop();
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
    await workerPromise;
  };
  if (!dependencies.disableSignals) {
    process.once('SIGTERM', () => stop().catch(error => console.error(error.message)));
    process.once('SIGINT', () => stop().catch(error => console.error(error.message)));
  }
  return { config, server, state, stop, worker };
}

if (require.main === module) {
  start().catch(error => {
    console.error(JSON.stringify({
      service: 'minmax-direct-mail-intake',
      level: 'error',
      code: error.code || 'STARTUP_FAILED',
      message: String(error.message || error).slice(0, 500),
    }));
    process.exitCode = 1;
  });
}

module.exports = { start };
