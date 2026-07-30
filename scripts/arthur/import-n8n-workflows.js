'use strict';

const fs = require('node:fs');
const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

const baseUrl = required('N8N_BASE_URL').replace(/\/$/, '');
const apiKey = required('N8N_API_KEY');
const arthurCredentialId = required('N8N_ARTHUR_CREDENTIAL_ID');
const telegramCredentialId = required('N8N_TELEGRAM_CREDENTIAL_ID');
const telegramChatId = required('N8N_TELEGRAM_CHAT_ID');
const activate = process.env.N8N_ACTIVATE_WORKFLOWS !== 'false';

const workflows = [
  'n8n/workflows/arthur-create-task-production.json',
  'n8n/workflows/arthur-morning-task-brief-production.json'
];

function sanitizeWorkflow(input) {
  const workflow = structuredClone(input);
  for (const node of workflow.nodes || []) {
    if (node.credentials?.httpHeaderAuth) {
      node.credentials.httpHeaderAuth.id = arthurCredentialId;
    }
    if (node.credentials?.telegramApi) {
      node.credentials.telegramApi.id = telegramCredentialId;
    }
    if (node.type === 'n8n-nodes-base.telegram' && node.parameters) {
      node.parameters.chatId = telegramChatId;
    }
  }
  delete workflow.id;
  delete workflow.active;
  delete workflow.versionId;
  delete workflow.createdAt;
  delete workflow.updatedAt;
  delete workflow.meta;
  delete workflow.tags;
  return workflow;
}

async function request(method, endpoint, body) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-n8n-api-key': apiKey
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${endpoint} failed: ${response.status} ${text}`);
  return data;
}

async function findByName(name) {
  const response = await request('GET', '/workflows?limit=250');
  const items = response?.data || response || [];
  return items.find(item => item.name === name) || null;
}

async function upsertWorkflow(file) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const payload = sanitizeWorkflow(raw);
  const existing = await findByName(payload.name);
  const saved = existing
    ? await request('PUT', `/workflows/${encodeURIComponent(existing.id)}`, payload)
    : await request('POST', '/workflows', payload);
  const id = saved.id || saved.data?.id || existing?.id;
  if (!id) throw new Error(`n8n did not return workflow id for ${payload.name}`);
  if (activate) await request('POST', `/workflows/${encodeURIComponent(id)}/activate`);
  return { id, name: payload.name, action: existing ? 'updated' : 'created', active: activate };
}

(async () => {
  const results = [];
  for (const file of workflows) results.push(await upsertWorkflow(file));
  console.log(JSON.stringify({ ok: true, workflows: results }, null, 2));
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
