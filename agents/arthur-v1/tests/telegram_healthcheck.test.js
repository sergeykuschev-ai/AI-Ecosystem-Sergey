'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHealthServer } = require('../telegram/healthcheck');

function loggerStub() {
  return { info() {}, error() {}, warn() {} };
}

test('health server returns gateway health and sends owner notification', async () => {
  const sent = [];
  const gateway = {
    config: { allowedUserIds: new Set(['12345']) },
    telegram: { sendMessage: async (chatId, text) => sent.push({ chatId, text }) },
    getHealth: () => ({ status: 'healthy', marker: 'ok' }),
  };
  const server = createHealthServer(gateway, 0, loggerStub());
  await once(server, 'listening');
  const { port } = server.address();

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'healthy', marker: 'ok' });

  const notify = await fetch(`http://127.0.0.1:${port}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'server alert' }),
  });
  assert.equal(notify.status, 202);
  assert.deepEqual(sent, [{ chatId: '12345', text: 'server alert' }]);

  await new Promise(resolve => server.close(resolve));
});
