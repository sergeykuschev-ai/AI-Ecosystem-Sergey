'use strict';

const { createTelegramGateway } = require('./telegram_gateway');
const { createHealthServer } = require('./healthcheck');
const { createLogger } = require('../logging/logger');
const { loadConfig } = require('./config');

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  logger.info('telegram_gateway_starting', null, {
    nodeEnv: process.env.NODE_ENV,
    healthPort: config.healthPort,
  });

  const gateway = createTelegramGateway({ config, logger });
  const healthServer = createHealthServer(gateway, config.healthPort, logger);

  function shutdown(signal) {
    logger.info('telegram_gateway_shutdown_signal', null, { signal });
    gateway.stop().then(() => {
      healthServer.close(() => {
        process.exit(0);
      });
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await gateway.start();
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
