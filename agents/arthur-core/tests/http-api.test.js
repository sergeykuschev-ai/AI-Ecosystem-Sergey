'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createArthurHttpServer } = require('../http/create-server');

async function withServer(runtime, work) {
  const server = createArthurHttpServer({ runtime });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function fakeRuntime() {
  const profiles = new Map();
  const tasks = new Map();
  let taskSequence = 0;
  return {
    async healthcheck() { return true; },
    service: {
      async createProfile(input) {
        profiles.set(input.id, { ...input, active: true });
        return profiles.get(input.id);
      },
      async getProfile(id) { return profiles.get(id) || null; },
      async createTask(input) {
        const task = { ...input, id: input.id || `task-${++taskSequence}`, status: 'new', priority: 'normal' };
        tasks.set(task.id, task);
        return task;
      },
      async getTask(ownerId, id) {
        const task = tasks.get(id);
        return task && task.ownerId === ownerId ? task : null;
      },
      async transitionTask(ownerId, id, status, patch) {
        const task = tasks.get(id);
        if (!task || task.ownerId !== ownerId) throw new Error('Task not found');
        const updated = { ...task, ...patch, status };
        tasks.set(id, updated);
        return updated;
      }
    }
  };
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

test('health endpoint reports Arthur Core status', async () => {
  await withServer(fakeRuntime(), async baseUrl => {
    const result = await jsonRequest(`${baseUrl}/health`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, service: 'arthur-core' });
  });
});

test('profile can be created and read', async () => {
  await withServer(fakeRuntime(), async baseUrl => {
    const created = await jsonRequest(`${baseUrl}/v1/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU' })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.id, 'sergey');

    const fetched = await jsonRequest(`${baseUrl}/v1/profiles/sergey`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.name, 'Сергей');
  });
});

test('task can be created, read and transitioned', async () => {
  await withServer(fakeRuntime(), async baseUrl => {
    const created = await jsonRequest(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arthur-actor-id': 'sergey' },
      body: JSON.stringify({ ownerId: 'sergey', domain: 'business', title: 'Проверить Min/Max' })
    });
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    const fetched = await jsonRequest(`${baseUrl}/v1/tasks/${id}?ownerId=sergey`);
    assert.equal(fetched.status, 200);

    const transitioned = await jsonRequest(`${baseUrl}/v1/tasks/${id}/transitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerId: 'sergey', status: 'in_progress' })
    });
    assert.equal(transitioned.status, 200);
    assert.equal(transitioned.body.data.status, 'in_progress');
  });
});

test('API rejects invalid JSON and missing ownerId', async () => {
  await withServer(fakeRuntime(), async baseUrl => {
    const invalid = await jsonRequest(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad'
    });
    assert.equal(invalid.status, 400);

    const missingOwner = await jsonRequest(`${baseUrl}/v1/tasks/task-1`);
    assert.equal(missingOwner.status, 400);
  });
});
