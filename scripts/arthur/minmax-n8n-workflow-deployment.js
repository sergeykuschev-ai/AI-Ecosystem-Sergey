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
const NODE_FALSE_DEFAULTS = Object.freeze([
  'disabled',
  'notesInFlow',
  'executeOnce',
  'alwaysOutputData',
  'retryOnFail',
  'continueOnFail',
]);
const WORKFLOW_SETTING_DEFAULTS = Object.freeze({
  availableInMCP: false,
  callerPolicy: 'workflowsFromSameOwner',
  errorWorkflow: '',
  executionOrder: 'v1',
  executionTimeout: -1,
  redactionPolicy: 'none',
  saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'all',
  saveExecutionProgress: false,
  saveManualExecutions: true,
  timeSavedPerExecution: 0,
});

function requiredEnvironment(name, environment = process.env) {
  const value = environment[name];
  if (!value || !String(value).trim()) {
    const typo = name === 'N8N_ARTHUR_CREDENTIAL_ID' &&
      environment.N88N_ARTHUR_CREDENTIAL_ID
      ? ' Possible typo detected: N88N_ARTHUR_CREDENTIAL_ID is set; ' +
        'rename it to N8N_ARTHUR_CREDENTIAL_ID.'
      : '';
    throw new Error(`${name} is required.${typo}`);
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

function pruneSemanticEmpty(value) {
  if (Array.isArray(value)) {
    const values = value
      .map(pruneSemanticEmpty)
      .filter(item => item !== undefined);
    return values.length > 0 ? values : undefined;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = pruneSemanticEmpty(child);
      if (normalized !== undefined) result[key] = normalized;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function canonicalizeCredentials(credentials) {
  const result = {};
  for (const [type, reference] of Object.entries(credentials || {}).sort()) {
    if (reference?.id === undefined || reference?.id === null) continue;
    result[type] = { id: String(reference.id) };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function nodeComparisonKey(node) {
  return node.id || node.name;
}

function canonicalizeNodeForComparison(node, options = {}) {
  const normalized = sanitizeNodeForPublicApi(node);
  if (options.ignoredGeneratedWebhookIds?.has(nodeComparisonKey(node))) {
    delete normalized.webhookId;
  }
  for (const field of NODE_FALSE_DEFAULTS) {
    if (normalized[field] === false) delete normalized[field];
  }
  if (normalized.onError === 'stopWorkflow') delete normalized.onError;
  if (normalized.retryOnFail !== true) {
    delete normalized.maxTries;
    delete normalized.waitBetweenTries;
  }
  normalized.credentials = canonicalizeCredentials(normalized.credentials);
  normalized.parameters = pruneSemanticEmpty(normalized.parameters);
  normalized.customTelemetryTags = pruneSemanticEmpty(
    normalized.customTelemetryTags
  );
  for (const field of Object.keys(normalized)) {
    if (normalized[field] === undefined) delete normalized[field];
  }
  return stableValue(normalized);
}

function canonicalizeConnections(connections) {
  // Object key order is serialization-only. Array order is retained because
  // output indexes and branch target order can affect workflow execution.
  return stableValue(structuredClone(connections || {}));
}

function canonicalizeSettings(settings) {
  const normalized = pruneSemanticEmpty(settings) || {};
  for (const [field, defaultValue] of Object.entries(
    WORKFLOW_SETTING_DEFAULTS
  )) {
    if (normalized[field] === defaultValue) delete normalized[field];
  }
  return stableValue(normalized);
}

function canonicalizeWorkflowForComparison(workflow, options = {}) {
  const canonical = {};
  for (const field of ['name', 'description']) {
    const value = pruneSemanticEmpty(workflow?.[field]);
    if (value !== undefined) canonical[field] = value;
  }
  canonical.nodes = (workflow?.nodes || [])
    .map(node => canonicalizeNodeForComparison(node, options))
    .sort((left, right) =>
      `${left.id || ''}\0${left.name || ''}`.localeCompare(
        `${right.id || ''}\0${right.name || ''}`
      )
    );
  canonical.connections = canonicalizeConnections(workflow?.connections);
  if (workflow?.settings !== undefined) {
    canonical.settings = canonicalizeSettings(workflow.settings);
  }
  for (const field of ['nodeGroups', 'pinData', 'staticData']) {
    const value = pruneSemanticEmpty(workflow?.[field]);
    if (value !== undefined) canonical[field] = stableValue(value);
  }
  return stableValue(canonical);
}

function collectValueDiffs(expected, actual, path = '', differences = []) {
  if (stableJson(expected) === stableJson(actual)) return differences;
  const expectedObject = expected && typeof expected === 'object';
  const actualObject = actual && typeof actual === 'object';
  if (!expectedObject || !actualObject ||
      Array.isArray(expected) !== Array.isArray(actual)) {
    differences.push({ path: path || '(root)', expected, actual });
    return differences;
  }
  if (Array.isArray(expected)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collectValueDiffs(
        expected[index],
        actual[index],
        `${path}[${index}]`,
        differences
      );
    }
    return differences;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    collectValueDiffs(
      expected[key],
      actual[key],
      path ? `${path}.${key}` : key,
      differences
    );
  }
  return differences;
}

function semanticWorkflowDiff(expectedWorkflow, actualWorkflow) {
  // n8n assigns UUID webhookIds on save to node types that expose webhook
  // definitions. Treat only IDs absent from the repository representation as
  // generated metadata; explicitly versioned webhookIds remain strict.
  const ignoredGeneratedWebhookIds = new Set(
    (expectedWorkflow?.nodes || [])
      .filter(node => !node.webhookId)
      .map(nodeComparisonKey)
  );
  const comparisonOptions = { ignoredGeneratedWebhookIds };
  const expected = canonicalizeWorkflowForComparison(
    expectedWorkflow,
    comparisonOptions
  );
  const actual = canonicalizeWorkflowForComparison(
    actualWorkflow,
    comparisonOptions
  );
  const differences = [];
  const expectedNodes = new Map(expected.nodes.map(node => [node.id || node.name, node]));
  const actualNodes = new Map(actual.nodes.map(node => [node.id || node.name, node]));
  const nodeKeys = new Set([...expectedNodes.keys(), ...actualNodes.keys()]);
  for (const key of [...nodeKeys].sort()) {
    const expectedNode = expectedNodes.get(key);
    const actualNode = actualNodes.get(key);
    const nodeName = expectedNode?.name || actualNode?.name || key;
    for (const difference of collectValueDiffs(expectedNode, actualNode)) {
      differences.push({ scope: nodeName, ...difference });
    }
  }
  const withoutNodes = value => {
    const copy = structuredClone(value);
    delete copy.nodes;
    return copy;
  };
  for (const difference of collectValueDiffs(
    withoutNodes(expected),
    withoutNodes(actual)
  )) {
    differences.push({ scope: 'workflow', ...difference });
  }
  return { expected, actual, differences };
}

function rawWorkflowDiff(expectedWorkflow, actualWorkflow) {
  const expected = stableValue(expectedWorkflow || {});
  const actual = stableValue(actualWorkflow || {});
  const differences = [];
  const expectedNodes = new Map(
    (expected.nodes || []).map(node => [node.id || node.name, node])
  );
  const actualNodes = new Map(
    (actual.nodes || []).map(node => [node.id || node.name, node])
  );
  const nodeKeys = new Set([...expectedNodes.keys(), ...actualNodes.keys()]);
  for (const key of [...nodeKeys].sort()) {
    const expectedNode = expectedNodes.get(key);
    const actualNode = actualNodes.get(key);
    const nodeName = expectedNode?.name || actualNode?.name || key;
    for (const difference of collectValueDiffs(expectedNode, actualNode)) {
      differences.push({ scope: nodeName, ...difference });
    }
  }
  const withoutNodes = value => {
    const copy = structuredClone(value);
    delete copy.nodes;
    return copy;
  };
  for (const difference of collectValueDiffs(
    withoutNodes(expected),
    withoutNodes(actual)
  )) {
    differences.push({ scope: 'workflow', ...difference });
  }
  return differences;
}

function printableValue(value) {
  return value === undefined ? '<missing>' : stableJson(value);
}

function formatSemanticDifference(difference) {
  return `${difference.scope} → ${difference.path} → expected ` +
    `${printableValue(difference.expected)} → actual ` +
    `${printableValue(difference.actual)}`;
}

function inspectWorkflowInvariants(
  workflow,
  credentials,
  expectedWorkflow
) {
  const issues = [];
  const http = inspectHttpNodes(
    workflow,
    credentials.httpHeaderAuth,
    expectedWorkflow
  );
  issues.push(...http.issues);

  const imap = (workflow.nodes || []).find(node =>
    node.type === 'n8n-nodes-base.emailReadImap'
  );
  if (!imap) {
    issues.push('IMAP node is missing');
  } else {
    if (imap.parameters?.mailbox !== 'INBOX') {
      issues.push(
        `${imap.name}: mailbox expected INBOX, actual ` +
        `${printableValue(imap.parameters?.mailbox)}`
      );
    }
    if (String(imap.parameters?.format || '').toLowerCase() !== 'resolved') {
      issues.push(
        `${imap.name}: format expected resolved, actual ` +
        `${printableValue(imap.parameters?.format)}`
      );
    }
    if (String(imap.credentials?.imap?.id || '') !== String(credentials.imap)) {
      issues.push(`${imap.name}: IMAP credential id differs from env`);
    }
  }

  const smtpNodes = (workflow.nodes || []).filter(node =>
    node.type === 'n8n-nodes-base.emailSend'
  );
  if (smtpNodes.length !== 2) {
    issues.push(`SMTP node count expected 2, actual ${smtpNodes.length}`);
  }
  for (const node of smtpNodes) {
    if (String(node.credentials?.smtp?.id || '') !== String(credentials.smtp)) {
      issues.push(`${node.name}: SMTP credential id differs from env`);
    }
  }

  for (const node of workflow.nodes || []) {
    const serialized = JSON.stringify(node.parameters || {});
    if (/\$env\b|process\.env\b/.test(serialized)) {
      issues.push(`${node.name}: forbidden env access is present`);
    }
  }
  return { issues, http };
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

function verificationIssues(
  record,
  expectedPayload,
  duplicates,
  credentials,
  expectedWorkflowId = record.id
) {
  const issues = [];
  if (String(record.id) !== String(expectedWorkflowId)) {
    issues.push(`id=${record.id}; expected stable id=${expectedWorkflowId}`);
  }
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

  const expectedDraft = draftStructure(expectedPayload);
  const deployedDraft = draftStructure(record);
  const expectedPublished = expectedActiveStructure(expectedPayload);
  const deployedPublished = activeStructure(record);
  const draftComparison = semanticWorkflowDiff(expectedDraft, deployedDraft);
  const publishedComparison = semanticWorkflowDiff(
    expectedPublished,
    deployedPublished
  );
  issues.push(...draftComparison.differences.map(
    difference => `draft: ${formatSemanticDifference(difference)}`
  ));
  issues.push(...publishedComparison.differences.map(
    difference => `published: ${formatSemanticDifference(difference)}`
  ));

  const draftInspection = inspectWorkflowInvariants(
    record,
    credentials,
    expectedPayload
  );
  issues.push(...draftInspection.issues);
  const publishedWorkflow = {
    nodes: record.activeVersion?.nodes || [],
    connections: record.activeVersion?.connections || {},
  };
  const publishedInspection = inspectWorkflowInvariants(
    publishedWorkflow,
    credentials,
    expectedPayload
  );
  issues.push(...publishedInspection.issues.map(
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
      repoDraft: structuralHash(draftComparison.expected),
      deployedDraft: structuralHash(draftComparison.actual),
      repoPublished: structuralHash(publishedComparison.expected),
      deployedPublished: structuralHash(publishedComparison.actual),
    },
    rawHashes: {
      repoDraft: structuralHash(expectedDraft),
      deployedDraft: structuralHash(deployedDraft),
      repoPublished: structuralHash(expectedPublished),
      deployedPublished: structuralHash(deployedPublished),
    },
    normalizations: {
      draft: rawWorkflowDiff(expectedDraft, deployedDraft),
      published: rawWorkflowDiff(expectedPublished, deployedPublished),
    },
    activeVersionId,
    httpNodes: draftInspection.http.summaries,
    publishedHttpNodes: publishedInspection.http.summaries,
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
    options.credentials,
    options.workflowId || DEFAULT_WORKFLOW_ID
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
    rawHashes: result.rawHashes,
    normalizations: result.normalizations,
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
  logger.log(`[PASS] semantic hashes: ${JSON.stringify(result.hashes)}`);
  if (
    result.rawHashes.repoDraft !== result.rawHashes.deployedDraft ||
    result.rawHashes.repoPublished !== result.rawHashes.deployedPublished
  ) {
    logger.log(
      `[PASS] raw hashes differ only by n8n normalization: ` +
      `${JSON.stringify(result.rawHashes)}`
    );
    for (const stage of ['draft', 'published']) {
      for (const difference of result.normalizations[stage]) {
        logger.log(
          `[INFO] n8n ${stage} normalization: ` +
          formatSemanticDifference(difference)
        );
      }
    }
  }
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
  canonicalizeWorkflowForComparison,
  checkRegistrySummary,
  deployWorkflow,
  deploymentConfig,
  draftStructure,
  expectedActiveStructure,
  inspectHttpNodes,
  inspectWorkflowInvariants,
  locateWorkflow,
  printVerification,
  readRepositoryWorkflow,
  requiredEnvironment,
  rawWorkflowDiff,
  sanitizeNodeForPublicApi,
  sanitizeNodesForPublicApi,
  stableJson,
  structuralHash,
  semanticWorkflowDiff,
  verificationIssues,
  verifyDeployedWorkflow,
  workflowPayload,
};
