'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_WORKFLOW_PATH = path.join(
  REPOSITORY_ROOT,
  'n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json'
);
const DEFAULT_WORKFLOW_ID = 'minmaxYandexIntakeFixed01';
const WORKFLOW_NAME = 'Arthur — MinMax Yandex Mail Intake (Fixed Config)';
const HTTP_NODE_IDS = Object.freeze([
  'register-ignored',
  'check-registry',
  'upload-excel',
  'poll-run-status',
  'fetch-summary',
  'fetch-items-summary',
  'mark-notification-sent',
  'mark-uncertain',
]);
// Public API schema from n8n 2.28.6:
// packages/cli/src/public-api/v1/handlers/workflows/spec/schemas/node.yml
// createdAt/updatedAt are read-only and therefore excluded from request bodies.
const NODE_PUBLIC_API_WRITABLE_FIELDS = Object.freeze([
  'id',
  'name',
  'webhookId',
  'disabled',
  'notesInFlow',
  'notes',
  'type',
  'typeVersion',
  'executeOnce',
  'alwaysOutputData',
  'retryOnFail',
  'maxTries',
  'waitBetweenTries',
  'continueOnFail',
  'onError',
  'position',
  'parameters',
  'credentials',
  'customTelemetryTags',
]);
const LEGACY_NODE_FIELD_ALIASES = Object.freeze({
  maxRetries: 'maxTries',
  waitBetweenRetries: 'waitBetweenTries',
});

function requiredEnvironment(name, environment = process.env) {
  const value = environment[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required`);
  }
  return String(value).trim();
}

function deploymentConfig(environment = process.env) {
  return {
    baseUrl: requiredEnvironment('N8N_BASE_URL', environment),
    apiKey: requiredEnvironment('N8N_API_KEY', environment),
    workflowId: String(
      environment.N8N_MINMAX_WORKFLOW_ID || DEFAULT_WORKFLOW_ID
    ).trim(),
    workflowPath: environment.N8N_MINMAX_WORKFLOW_PATH
      ? path.resolve(environment.N8N_MINMAX_WORKFLOW_PATH)
      : DEFAULT_WORKFLOW_PATH,
    credentials: {
      httpHeaderAuth: requiredEnvironment(
        'N8N_ARTHUR_CREDENTIAL_ID',
        environment
      ),
      imap: requiredEnvironment(
        'N8N_MINMAX_IMAP_CREDENTIAL_ID',
        environment
      ),
      smtp: requiredEnvironment(
        'N8N_MINMAX_SMTP_CREDENTIAL_ID',
        environment
      ),
    },
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function structuralHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function readRepositoryWorkflow(workflowPath = DEFAULT_WORKFLOW_PATH) {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  if (workflow.name !== WORKFLOW_NAME) {
    throw new Error(
      `Unexpected workflow name in ${workflowPath}: ${workflow.name}`
    );
  }
  return workflow;
}

function bindCredentials(workflow, credentials) {
  const bound = structuredClone(workflow);
  for (const node of bound.nodes || []) {
    if (node.credentials?.httpHeaderAuth) {
      node.credentials.httpHeaderAuth.id = credentials.httpHeaderAuth;
    }
    if (node.credentials?.imap) {
      node.credentials.imap.id = credentials.imap;
    }
    if (node.credentials?.smtp) {
      node.credentials.smtp.id = credentials.smtp;
    }
  }
  return bound;
}

function sanitizeNodeForPublicApi(node) {
  const sanitized = {};
  for (const field of NODE_PUBLIC_API_WRITABLE_FIELDS) {
    if (node[field] !== undefined) {
      sanitized[field] = structuredClone(node[field]);
    }
  }
  for (const [legacyField, publicApiField] of Object.entries(
    LEGACY_NODE_FIELD_ALIASES
  )) {
    if (node[legacyField] === undefined) continue;
    if (
      sanitized[publicApiField] !== undefined &&
      sanitized[publicApiField] !== node[legacyField]
    ) {
      throw new Error(
        `${node.name || node.id}: conflicting ${legacyField} and ` +
        `${publicApiField} values`
      );
    }
    sanitized[publicApiField] = structuredClone(node[legacyField]);
  }
  return sanitized;
}

function sanitizeNodesForPublicApi(nodes) {
  return (nodes || []).map(sanitizeNodeForPublicApi);
}

function workflowPayload(workflow, credentials) {
  const bound = bindCredentials(workflow, credentials);
  const payload = {
    name: bound.name,
    nodes: sanitizeNodesForPublicApi(bound.nodes),
    connections: bound.connections,
    settings: bound.settings,
  };
  for (const field of [
    'description',
    'nodeGroups',
    'pinData',
    'staticData',
  ]) {
    if (bound[field] !== undefined) payload[field] = bound[field];
  }
  return payload;
}

function draftStructure(workflow) {
  const structure = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
  };
  for (const field of [
    'description',
    'nodeGroups',
    'pinData',
    'staticData',
  ]) {
    if (workflow[field] !== undefined) structure[field] = workflow[field];
  }
  return structure;
}

function activeStructure(workflow) {
  return {
    nodes: workflow.activeVersion?.nodes,
    connections: workflow.activeVersion?.connections,
    ...(workflow.activeVersion?.nodeGroups !== undefined
      ? { nodeGroups: workflow.activeVersion.nodeGroups }
      : {}),
  };
}

function expectedActiveStructure(payload) {
  return {
    nodes: payload.nodes,
    connections: payload.connections,
    ...(payload.nodeGroups !== undefined
      ? { nodeGroups: payload.nodeGroups }
      : {}),
  };
}

function inspectHttpNodes(
  workflow,
  expectedCredentialId,
  expectedWorkflow = null
) {
  const nodes = (workflow.nodes || []).filter(
    node => node.type === 'n8n-nodes-base.httpRequest'
  );
  const issues = [];
  const actualIds = nodes.map(node => node.id).sort();
  const expectedIds = [...HTTP_NODE_IDS].sort();
  const expectedById = new Map(
    (expectedWorkflow?.nodes || []).map(node => [node.id, node])
  );
  if (stableJson(actualIds) !== stableJson(expectedIds)) {
    issues.push(
      `HTTP node ids differ: actual=${actualIds.join(',')}; ` +
      `expected=${expectedIds.join(',')}`
    );
  }

  const summaries = [];
  for (const node of nodes) {
    const headers = node.parameters?.headerParameters?.parameters || [];
    const accept = headers.find(
      header => String(header.name).toLowerCase() === 'accept'
    );
    const responseFormat =
      node.parameters?.options?.response?.response?.responseFormat;
    const credential = node.credentials?.httpHeaderAuth;
    const expectedNode = expectedById.get(node.id);
    if (
      expectedNode &&
      (node.parameters?.method || 'GET') !==
        (expectedNode.parameters?.method || 'GET')
    ) {
      issues.push(`${node.name}: HTTP method differs from repository`);
    }
    if (
      expectedNode &&
      node.parameters?.url !== expectedNode.parameters?.url
    ) {
      issues.push(`${node.name}: URL differs from repository`);
    }
    if (node.parameters?.sendHeaders !== true) {
      issues.push(`${node.name}: sendHeaders must be true`);
    }
    if (accept?.value !== 'application/json') {
      issues.push(`${node.name}: Accept must be application/json`);
    }
    if (responseFormat !== 'json') {
      issues.push(`${node.name}: Response Format must be json`);
    }
    if (
      node.parameters?.authentication !== 'genericCredentialType' ||
      node.parameters?.genericAuthType !== 'httpHeaderAuth'
    ) {
      issues.push(`${node.name}: Header Auth is not configured`);
    }
    if (credential?.name !== 'Arthur Core API') {
      issues.push(`${node.name}: credential name must be Arthur Core API`);
    }
    if (String(credential?.id || '') !== String(expectedCredentialId)) {
      issues.push(`${node.name}: credential id differs from env`);
    }
    summaries.push({
      id: node.id,
      name: node.name,
      method: node.parameters?.method || 'GET',
      url: node.parameters?.url || '',
      accept: accept?.value || null,
      responseFormat: responseFormat || null,
      credentialId: credential?.id || null,
      credentialName: credential?.name || null,
    });
  }
  return { issues, summaries };
}

class N8nApiClient {
  constructor(options) {
    const baseUrl = String(options.baseUrl).replace(/\/+$/, '');
    this.baseUrl = baseUrl.endsWith('/api/v1')
      ? baseUrl
      : `${baseUrl}/api/v1`;
    this.apiKey = options.apiKey;
    this.fetch = options.fetch || globalThis.fetch;
  }

  async request(method, endpoint, body, expectedStatuses = [200]) {
    const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-n8n-api-key': this.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!/^application\/json(?:;|$)/i.test(contentType) || data === null) {
      throw new Error(
        `${method} ${endpoint} returned non-JSON: HTTP ${response.status}; ` +
        `content-type=${contentType || '(empty)'}; body=${text.slice(0, 240)}`
      );
    }
    if (!expectedStatuses.includes(response.status)) {
      throw new Error(
        `${method} ${endpoint} failed: HTTP ${response.status}; ` +
        `${JSON.stringify(data).slice(0, 500)}`
      );
    }
    return data;
  }

  async getWorkflow(id, options = {}) {
    const result = await this.request(
      'GET',
      `/workflows/${encodeURIComponent(id)}`,
      undefined,
      options.allowMissing ? [200, 404] : [200]
    );
    return result?.id ? result : null;
  }

  async listWorkflows() {
    const workflows = [];
    let cursor = null;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const page = await this.request('GET', `/workflows?${query}`);
      workflows.push(...(page.data || []));
      cursor = page.nextCursor || null;
    } while (cursor);
    return workflows;
  }

  updateWorkflow(id, payload) {
    return this.request(
      'PUT',
      `/workflows/${encodeURIComponent(id)}`,
      payload
    );
  }

  createWorkflow(payload) {
    return this.request('POST', '/workflows', payload, [200, 201]);
  }

  activateWorkflow(id, versionId) {
    return this.request(
      'POST',
      `/workflows/${encodeURIComponent(id)}/activate`,
      { versionId }
    );
  }

  deactivateWorkflow(id) {
    return this.request(
      'POST',
      `/workflows/${encodeURIComponent(id)}/deactivate`,
      {}
    );
  }

  archiveWorkflow(id) {
    return this.request(
      'POST',
      `/workflows/${encodeURIComponent(id)}/archive`,
      {}
    );
  }

  unarchiveWorkflow(id) {
    return this.request(
      'POST',
      `/workflows/${encodeURIComponent(id)}/unarchive`,
      {}
    );
  }
}

async function locateWorkflow(client, preferredId, workflowName) {
  const preferred = preferredId
    ? await client.getWorkflow(preferredId, { allowMissing: true })
    : null;
  const workflows = await client.listWorkflows();
  const named = workflows.filter(item => item.name === workflowName);

  if (preferred && preferred.name !== workflowName) {
    throw new Error(
      `Workflow id ${preferredId} belongs to "${preferred.name}", ` +
      `not "${workflowName}".`
    );
  }
  if (preferred) {
    return {
      workflow: preferred,
      duplicates: named.filter(item => item.id !== preferred.id),
    };
  }
  const deployable = named.filter(item => !item.isArchived);
  if (deployable.length > 1) {
    throw new Error(
      `Found ${deployable.length} non-archived workflows named ` +
      `"${workflowName}" and preferred id ${preferredId} does not exist.`
    );
  }
  return {
    workflow: deployable[0] || null,
    duplicates: named.filter(item => item.id !== deployable[0]?.id),
  };
}

function verificationIssues(record, expectedPayload, duplicates, credentialId) {
  const issues = [];
  if (record.name !== expectedPayload.name) {
    issues.push(`name=${record.name}; expected=${expectedPayload.name}`);
  }
  if (record.active !== true) issues.push('workflow is not active/published');
  if (!record.versionId) issues.push('draft versionId is missing');
  const activeVersionId =
    record.activeVersion?.versionId || record.activeVersionId || null;
  if (!activeVersionId) issues.push('activeVersionId is missing');
  if (
    record.versionId &&
    activeVersionId &&
    record.versionId !== activeVersionId
  ) {
    issues.push(
      `published version ${activeVersionId} differs from draft ` +
      `${record.versionId}`
    );
  }

  const expectedDraftHash = structuralHash(draftStructure(expectedPayload));
  const deployedDraftHash = structuralHash(draftStructure(record));
  if (expectedDraftHash !== deployedDraftHash) {
    issues.push(
      `draft structure hash differs: deployed=${deployedDraftHash}; ` +
      `repo=${expectedDraftHash}`
    );
  }
  const expectedActiveHash = structuralHash(
    expectedActiveStructure(expectedPayload)
  );
  const deployedActiveHash = structuralHash(activeStructure(record));
  if (expectedActiveHash !== deployedActiveHash) {
    issues.push(
      `published structure hash differs: deployed=${deployedActiveHash}; ` +
      `repo=${expectedActiveHash}`
    );
  }

  const httpInspection = inspectHttpNodes(
    record,
    credentialId,
    expectedPayload
  );
  issues.push(...httpInspection.issues);
  const publishedHttpInspection = inspectHttpNodes(
    { nodes: record.activeVersion?.nodes || [] },
    credentialId,
    expectedPayload
  );
  issues.push(...publishedHttpInspection.issues.map(
    issue => `published: ${issue}`
  ));
  const liveDuplicates = duplicates.filter(item => !item.isArchived);
  if (liveDuplicates.length > 0) {
    issues.push(
      `duplicate non-archived workflow ids: ` +
      liveDuplicates.map(item => item.id).join(',')
    );
  }
  return {
    issues,
    hashes: {
      repoDraft: expectedDraftHash,
      deployedDraft: deployedDraftHash,
      repoPublished: expectedActiveHash,
      deployedPublished: deployedActiveHash,
    },
    activeVersionId,
    httpNodes: httpInspection.summaries,
    publishedHttpNodes: publishedHttpInspection.summaries,
  };
}

async function verifyDeployedWorkflow(options) {
  const client = options.client || new N8nApiClient(options);
  const repositoryWorkflow = options.repositoryWorkflow ||
    readRepositoryWorkflow(options.workflowPath);
  const expectedPayload = workflowPayload(
    repositoryWorkflow,
    options.credentials
  );
  const located = await locateWorkflow(
    client,
    options.workflowId || DEFAULT_WORKFLOW_ID,
    repositoryWorkflow.name
  );
  if (!located.workflow) {
    throw new Error(`Workflow "${repositoryWorkflow.name}" not found in n8n.`);
  }
  const record = await client.getWorkflow(located.workflow.id);
  const result = verificationIssues(
    record,
    expectedPayload,
    located.duplicates,
    options.credentials.httpHeaderAuth
  );
  if (result.issues.length > 0) {
    throw Object.assign(
      new Error(
        `Deployed MinMax workflow verification failed:\n- ` +
        result.issues.join('\n- ')
      ),
      { verification: { record, ...result } }
    );
  }
  return {
    record: {
      id: record.id,
      name: record.name,
      active: record.active,
      versionId: record.versionId,
      activeVersionId: result.activeVersionId,
      updatedAt: record.updatedAt,
    },
    hashes: result.hashes,
    httpNodes: result.httpNodes,
    publishedHttpNodes: result.publishedHttpNodes,
    archivedDuplicateIds: located.duplicates
      .filter(item => item.isArchived)
      .map(item => item.id),
  };
}

async function deployWorkflow(options) {
  const client = options.client || new N8nApiClient(options);
  const repositoryWorkflow = options.repositoryWorkflow ||
    readRepositoryWorkflow(options.workflowPath);
  const payload = workflowPayload(repositoryWorkflow, options.credentials);
  const contract = inspectHttpNodes(
    payload,
    options.credentials.httpHeaderAuth
  );
  if (contract.issues.length > 0) {
    throw new Error(
      `Repository workflow is invalid:\n- ${contract.issues.join('\n- ')}`
    );
  }

  const located = await locateWorkflow(
    client,
    options.workflowId || DEFAULT_WORKFLOW_ID,
    repositoryWorkflow.name
  );
  let saved;
  let action;
  if (located.workflow) {
    if (located.workflow.isArchived) {
      await client.unarchiveWorkflow(located.workflow.id);
    }
    saved = await client.updateWorkflow(located.workflow.id, payload);
    action = 'updated';
  } else {
    saved = await client.createWorkflow(payload);
    action = 'created';
  }
  const workflowId = saved.id || located.workflow?.id;
  if (!workflowId) throw new Error('n8n did not return a workflow id.');
  const savedDetail = saved.versionId
    ? saved
    : await client.getWorkflow(workflowId);
  if (!savedDetail.versionId) {
    throw new Error(`n8n did not return versionId for workflow ${workflowId}.`);
  }

  await client.activateWorkflow(workflowId, savedDetail.versionId);

  const archivedDuplicateIds = [];
  for (const duplicate of located.duplicates) {
    if (duplicate.isArchived) continue;
    if (duplicate.active || duplicate.activeVersionId) {
      await client.deactivateWorkflow(duplicate.id);
    }
    await client.archiveWorkflow(duplicate.id);
    archivedDuplicateIds.push(duplicate.id);
  }

  const verification = await verifyDeployedWorkflow({
    ...options,
    client,
    repositoryWorkflow,
    workflowId,
  });
  return {
    action,
    workflowId,
    publishedVersionId: savedDetail.versionId,
    archivedDuplicateIds,
    verification,
  };
}

function checkRegistrySummary(httpNodes) {
  return httpNodes.find(node => node.id === 'check-registry') || null;
}

function printVerification(result, logger = console) {
  logger.log(`[PASS] workflow record: ${JSON.stringify(result.record)}`);
  logger.log(`[PASS] structural hashes: ${JSON.stringify(result.hashes)}`);
  logger.log(`[PASS] 8 HTTP nodes: ${result.httpNodes.length}`);
  logger.log(
    `[PASS] draft Проверить реестр: ` +
    `${JSON.stringify(checkRegistrySummary(result.httpNodes))}`
  );
  logger.log(
    `[PASS] published Проверить реестр: ` +
    `${JSON.stringify(checkRegistrySummary(result.publishedHttpNodes))}`
  );
  if (result.archivedDuplicateIds.length > 0) {
    logger.log(
      `[PASS] archived duplicate ids: ${result.archivedDuplicateIds.join(',')}`
    );
  }
  logger.log(
    '[PASS] Deployed Fixed MinMax workflow matches repository and ' +
    'published version.'
  );
}

module.exports = {
  DEFAULT_WORKFLOW_ID,
  DEFAULT_WORKFLOW_PATH,
  HTTP_NODE_IDS,
  N8nApiClient,
  NODE_PUBLIC_API_WRITABLE_FIELDS,
  WORKFLOW_NAME,
  activeStructure,
  bindCredentials,
  checkRegistrySummary,
  deployWorkflow,
  deploymentConfig,
  draftStructure,
  expectedActiveStructure,
  inspectHttpNodes,
  locateWorkflow,
  printVerification,
  readRepositoryWorkflow,
  requiredEnvironment,
  sanitizeNodeForPublicApi,
  sanitizeNodesForPublicApi,
  stableJson,
  structuralHash,
  verificationIssues,
  verifyDeployedWorkflow,
  workflowPayload,
};
