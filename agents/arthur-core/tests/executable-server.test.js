'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parsePort, parseHost, startArthurServer } = require('../runtime/start-server');

function silentLogger() {
  return { info() {}, error() {} };
}

test('server configuration validates host, port and shutdown timeout', async () => {
  assert.equal(parsePort(undefined), 8787);
  assert.equal(parsePort('0'), 0);
  assert.equal(parseHost(undefined), '127.0.0.1');
  assert.equal(parseHost(' 0.0.0.0 '), '0.0.0.0');
  assert.throws(() => parsePort('70000'), /between 0 and 65535/);
  assert.throws(() => parsePort('abc'), /between 0 and 65535/);
  assert.throws(() => parseHost(''), /non-empty string/);

  await assert.rejects(
    startArthurServer({
      env: { ARTHUR_HTTP_PORT: '0', ARTHUR_SHUTDOWN_TIMEOUT_MS: '0' },
      runtimeFactory: () => ({ close: async () => {}, healthcheck: async () => true, service: {} }),
      logger: silentLogger()
    }),
    /positive integer/
  );
});

test('executable server listens, serves health and closes runtime gracefully', async () => {
  let closed = 0;
  const runtime = {
    service: {},
    async healthcheck() { return true; },
    async close() { closed += 1; }
  };

  const app = await startArthurServer({
    env: {
      ARTHUR_HTTP_HOST: '127.0.0.1',
      ARTHUR_HTTP_PORT: '0',
      ARTHUR_SHUTDOWN_TIMEOUT_MS: '1000'
    },
    runtimeFactory: () => runtime,
    logger: silentLogger()
  });

  const response = await fetch(`http://127.0.0.1:${app.address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'arthur-core' });

  await app.stop('test');
  await app.stop('test-again');
  assert.equal(closed, 1);
  assert.equal(app.server.listening, false);
});

test('startup rejects occupied port without leaving runtime open', async () => {
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const occupiedPort = blocker.address().port;

  try {
    await assert.rejects(
      startArthurServer({
        env: { ARTHUR_HTTP_HOST: '127.0.0.1', ARTHUR_HTTP_PORT: String(occupiedPort) },
        runtimeFactory: () => ({ close: async () => {}, healthcheck: async () => true, service: {} }),
        logger: silentLogger()
      }),
      error => error && error.code === 'EADDRINUSE'
    );
  } finally {
    await new Promise(resolve => blocker.close(resolve));
  }
});
