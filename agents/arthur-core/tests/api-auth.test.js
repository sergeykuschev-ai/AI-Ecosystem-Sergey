'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createArthurHttpServer } = require('../http/create-server');

function createRuntime() {
  return {
    service: {
      async getProfile(id) { return { id }; }
    },
    async healthcheck() { return true; }
  };
}

test('health remains available while v1 routes require configured token', async t => {
  const server = createArthurHttpServer({ runtime: createRuntime(), apiToken: 'secret-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);

  const missing = await fetch(`${baseUrl}/v1/profiles/sergey`);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.code, 'unauthorized');

  const wrong = await fetch(`${baseUrl}/v1/profiles/sergey`, {
    headers: { authorization: 'Bearer wrong-token' }
  });
  assert.equal(wrong.status, 401);

  const authorized = await fetch(`${baseUrl}/v1/profiles/sergey`, {
    headers: { authorization: 'Bearer secret-token' }
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).data.id, 'sergey');
});

test('x-arthur-api-token header is supported for n8n', async t => {
  const server = createArthurHttpServer({ runtime: createRuntime(), apiToken: 'n8n-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/profiles/sergey`, {
    headers: { 'x-arthur-api-token': 'n8n-token' }
  });
  assert.equal(response.status, 200);
});