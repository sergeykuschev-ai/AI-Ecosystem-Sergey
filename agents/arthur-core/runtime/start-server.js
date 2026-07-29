'use strict';

const { createArthurRuntime } = require('./create-runtime');
const { createArthurHttpServer } = require('../http/create-server');

function parsePort(value) {
  const port = Number(value === undefined ? 8787 : value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('ARTHUR_HTTP_PORT must be an integer between 0 and 65535');
  }
  return port;
}

function parseHost(value) {
  const host = value === undefined ? '127.0.0.1' : value;
  if (typeof host !== 'string' || host.trim() === '') {
    throw new TypeError('ARTHUR_HTTP_HOST must be a non-empty string');
  }
  return host.trim();
}

function parseShutdownTimeout(value) {
  const timeout = Number(value === undefined ? 10000 : value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new RangeError('ARTHUR_SHUTDOWN_TIMEOUT_MS must be a positive integer');
  }
  return timeout;
}

async function startArthurServer({
  env = process.env,
  runtimeFactory = createArthurRuntime,
  serverFactory = createArthurHttpServer,
  logger = console
} = {}) {
  const host = parseHost(env.ARTHUR_HTTP_HOST);
  const port = parsePort(env.ARTHUR_HTTP_PORT);
  const shutdownTimeoutMs = parseShutdownTimeout(env.ARTHUR_SHUTDOWN_TIMEOUT_MS);
  const runtime = runtimeFactory({ env });
  const server = serverFactory({ runtime });

  let stopping = false;
  let stopped = false;

  async function stop(signal = 'manual') {
    if (stopped || stopping) return;
    stopping = true;

    const forceTimer = setTimeout(() => {
      logger.error?.(`Arthur Core forced shutdown after ${shutdownTimeoutMs}ms`);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }, shutdownTimeoutMs);
    forceTimer.unref?.();

    try {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
      }
      await runtime.close();
      stopped = true;
      logger.info?.(`Arthur Core stopped (${signal})`);
    } finally {
      clearTimeout(forceTimer);
      stopping = false;
    }
  }

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }

  const address = server.address();
  logger.info?.(`Arthur Core listening on http://${address.address}:${address.port}`);

  return { runtime, server, address, stop };
}

async function main() {
  const app = await startArthurServer();
  const handleSignal = signal => {
    app.stop(signal)
      .then(() => process.exit(0))
      .catch(error => {
        console.error(error);
        process.exit(1);
      });
  };

  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('SIGINT', () => handleSignal('SIGINT'));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { parsePort, parseHost, parseShutdownTimeout, startArthurServer, main };
